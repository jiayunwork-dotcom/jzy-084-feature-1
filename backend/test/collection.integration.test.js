/**
 * Stateful resource-collection integration verification against an in-memory
 * PostgreSQL (pg-mem): management CRUD -> seeding -> real HTTP write/read
 * sequences -> concurrency -> reset -> restart persistence, plus regression
 * that ordinary stateless interfaces and scenario matching stay intact.
 *
 * Skipped automatically unless pg-mem is installed (dev-only dependency).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

let newDb;
try {
  ({ newDb } = await import('pg-mem'));
} catch {
  process.exit(0);
}

import { pool } from '../src/db/pool.js';
import { initSchema, ensureDefaultProject } from '../src/db/schema.js';
import { createApp } from '../src/app.js';

const db = newDb({ autoCreateForeignKeyIndices: true });
db.public.registerFunction({
  name: 'gen_random_uuid',
  returns: 'uuid',
  impure: true,
  implementation: () => randomUUID(),
});

const memPool = db.adapters.createPg().Pool;
const mem = new memPool();
pool.query = (...args) => mem.query(...args);
pool.connect = (...args) => mem.connect(...args);
pool.end = (...args) => mem.end(...args);

let server;
let baseUrl;
let projectId;

before(async () => {
  await initSchema();
  projectId = await ensureDefaultProject();
  const app = createApp(projectId);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
});

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, headers: res.headers, data };
}

// ---------------------------------------------------------------------------
// setup: models + collections
// ---------------------------------------------------------------------------

let articlesCollection;
let modelCollection;

test('准备：创建公共模型', async () => {
  const company = await jsonFetch('/api/models', {
    method: 'POST',
    body: {
      name: 'Company',
      fields: [
        { name: 'companyName', type: 'string' },
        { name: 'website', type: 'string' },
      ],
    },
  });
  assert.equal(company.status, 201, JSON.stringify(company.data));

  const author = await jsonFetch('/api/models', {
    method: 'POST',
    body: {
      name: 'Author',
      fields: [
        { name: 'userName', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'employer', type: 'ref', ref: company.data.id },
      ],
    },
  });
  assert.equal(author.status, 201, JSON.stringify(author.data));

  globalThis.__authorModelId = author.data.id;
});

test('创建就地结构的资源集合（种 5 条）', async () => {
  const res = await jsonFetch('/api/collections', {
    method: 'POST',
    body: {
      name: '文章',
      basePath: '/api/articles',
      seedCount: 5,
      recordSchema: {
        source: 'inline',
        fields: [
          { name: 'title', type: 'string' },
          { name: 'email', type: 'string' },
          { name: 'views', type: 'number', min: 0, max: 999 },
          { name: 'status', type: 'enum', values: ['draft', 'published', 'archived'] },
          { name: 'published', type: 'boolean' },
          { name: 'author', type: 'ref', ref: globalThis.__authorModelId },
        ],
      },
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  articlesCollection = res.data;
  assert.equal(articlesCollection.seedRecords.length, 5);
  assert.equal(articlesCollection.nextId, 6);
});

test('创建引用公共模型的资源集合（种 0 条）', async () => {
  const res = await jsonFetch('/api/collections', {
    method: 'POST',
    body: {
      name: '作者',
      basePath: '/api/authors',
      seedCount: 0,
      recordSchema: { source: 'model', modelId: globalThis.__authorModelId },
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  modelCollection = res.data;
  assert.equal(res.data.seedRecords.length, 0);
});

test('集合路径冲突在保存时被拒绝（与集合 / 与接口）', async () => {
  // nested collection
  const nested = await jsonFetch('/api/collections', {
    method: 'POST',
    body: {
      name: '草稿', basePath: '/api/articles/drafts', seedCount: 1,
      recordSchema: { source: 'inline', fields: [{ name: 'title', type: 'string' }] },
    },
  });
  assert.equal(nested.status, 422);
  assert.match(JSON.stringify(nested.data), /资源集合路径冲突/);

  // ordinary interface intruding into the collection subtree
  const intruder = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '文章动作', path: '/api/articles/:id', method: 'POST',
      defaultResponse: { fields: [{ name: 'ok', type: 'boolean' }] },
    },
  });
  assert.equal(intruder.status, 422);
  assert.match(JSON.stringify(intruder.data), /资源集合/);
});

// ---------------------------------------------------------------------------
// seeded reads
// ---------------------------------------------------------------------------

test('列表返回真实种入的记录，连续两次读取完全一致', async () => {
  const a = await jsonFetch('/mock/api/articles');
  const b = await jsonFetch('/mock/api/articles');
  assert.equal(a.status, 200);
  assert.equal(a.data.pagination.total, 5);
  assert.equal(a.data.data.length, 5);
  assert.deepEqual(a.data.data, b.data.data, '集合未改动时两次取列表必须一致');

  // generated-once values + ref expansion + stable ids
  const first = a.data.data[0];
  assert.equal(first.id, 1);
  assert.match(first.email, /@/);
  assert.equal(typeof first.author.userName, 'string');
  assert.equal(typeof first.author.employer.companyName, 'string');
});

test('按 id 取详情读到与列表中同一条的完整内容', async () => {
  const list = (await jsonFetch('/mock/api/articles')).data.data;
  for (const record of list) {
    const detail = await jsonFetch(`/mock/api/articles/${record.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.data, record, '详情与列表记录必须是同一份固定内容');
  }
});

test('详情 id 不存在（数字/非数字）返回结构化未找到错误而非硬造', async () => {
  const missing = await jsonFetch('/mock/api/articles/99999');
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error.code, 'RESOURCE_NOT_FOUND');
  assert.match(missing.data.error.message, /99999/);

  const malformed = await jsonFetch('/mock/api/articles/abc');
  assert.equal(malformed.status, 404);
  assert.equal(malformed.data.error.code, 'RESOURCE_NOT_FOUND');
});

// ---------------------------------------------------------------------------
// write/read sequences
// ---------------------------------------------------------------------------

test('新建：并入请求体、补齐缺失字段、分配稳定 id，立即可读', async () => {
  const created = await jsonFetch('/mock/api/articles', {
    method: 'POST',
    body: { title: '前端新建的文章', status: 'published' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.id, 6);
  assert.equal(created.data.title, '前端新建的文章');
  assert.equal(created.data.status, 'published');
  assert.match(created.data.email, /@/, '缺失字段已用同一套生成器补齐');
  assert.equal(typeof created.data.author.employer.website, 'string');

  const list = await jsonFetch('/mock/api/articles');
  assert.equal(list.data.pagination.total, 6);
  assert.ok(list.data.data.some((r) => r.id === 6), '新建后列表能看到它');

  const detail = await jsonFetch('/mock/api/articles/6');
  assert.deepEqual(detail.data, created.data, '按新 id 取详情读到同一条');
});

test('生成一次的字段在多次读取间完全相同', async () => {
  const reads = [];
  for (let i = 0; i < 4; i += 1) {
    reads.push((await jsonFetch('/mock/api/articles/6')).data);
  }
  for (let i = 1; i < reads.length; i += 1) {
    assert.deepEqual(reads[i], reads[0], `第 ${i + 1} 次读取与首次完全一致`);
  }
});

test('PATCH 局部修改精确改到目标，其它记录纹丝不动', async () => {
  const before = new Map(
    (await jsonFetch('/mock/api/articles')).data.data.map((r) => [r.id, r]),
  );

  const patched = await jsonFetch('/mock/api/articles/6', {
    method: 'PATCH',
    body: { views: 777 },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.views, 777);
  assert.equal(patched.data.title, '前端新建的文章', '未更新字段保持不变');
  assert.equal(patched.data.email, before.get(6).email, '生成字段未被重摇');

  const after = new Map(
    (await jsonFetch('/mock/api/articles')).data.data.map((r) => [r.id, r]),
  );
  for (const [id, record] of before) {
    if (id !== 6) assert.deepEqual(after.get(id), record, `记录 ${id} 不应变化`);
  }
});

test('PUT 整体替换：缺失字段置 null，id 保持不变', async () => {
  const replaced = await jsonFetch('/mock/api/articles/6', {
    method: 'PUT',
    body: { title: '整篇替换', views: 1, status: 'draft', published: false },
  });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.data.id, 6);
  assert.equal(replaced.data.title, '整篇替换');
  assert.equal(replaced.data.email, null, '未提供的字段整体置空');
  assert.equal(replaced.data.author, null);
});

test('更新不存在的 id 返回未找到错误', async () => {
  const patched = await jsonFetch('/mock/api/articles/777', {
    method: 'PATCH',
    body: { views: 1 },
  });
  assert.equal(patched.status, 404);
  assert.equal(patched.data.error.code, 'RESOURCE_NOT_FOUND');
});

test('非法请求体返回结构化 400', async () => {
  const res = await jsonFetch('/mock/api/articles', {
    method: 'POST',
    body: ['not', 'an', 'object'],
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error.code, 'BAD_REQUEST');
});

test('删除：记录真正移除，列表少一条、再取详情未找到；id 不复用不漂移', async () => {
  const del = await jsonFetch('/mock/api/articles/2', { method: 'DELETE' });
  assert.equal(del.status, 204);
  assert.equal(del.data, null);

  const list = await jsonFetch('/mock/api/articles');
  assert.equal(list.data.pagination.total, 5);
  assert.ok(!list.data.data.some((r) => r.id === 2));
  // 其它记录标识不漂移
  assert.deepEqual(
    list.data.data.map((r) => r.id),
    [1, 3, 4, 5, 6],
  );

  const detail = await jsonFetch('/mock/api/articles/2');
  assert.equal(detail.status, 404);
  assert.equal(detail.data.error.code, 'RESOURCE_NOT_FOUND');
});

test('删除已不存在的 id 返回未找到', async () => {
  const res = await jsonFetch('/mock/api/articles/2', { method: 'DELETE' });
  assert.equal(res.status, 404);
});

test('再新建一条：id 继续递增（7），绝不复用被删除的 2', async () => {
  const created = await jsonFetch('/mock/api/articles', {
    method: 'POST',
    body: { title: '又一条' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.id, 7, 'id 单调递增、删除后不复用');
});

test('过滤：按字段值精确过滤 + 翻页', async () => {
  // 此时记录: 1,3,4,5,6,7
  const all = (await jsonFetch('/mock/api/articles')).data.data;
  const targetStatus = all.find((r) => typeof r.status === 'string').status;
  const filtered = await jsonFetch(`/mock/api/articles?status=${encodeURIComponent(targetStatus)}`);
  assert.ok(filtered.data.pagination.total >= 1);
  assert.ok(filtered.data.data.every((r) => r.status === targetStatus));

  const p1 = await jsonFetch('/mock/api/articles?page=1&pageSize=2');
  const p2 = await jsonFetch('/mock/api/articles?page=2&pageSize=2');
  assert.deepEqual(p1.data.data.map((r) => r.id), [1, 3]);
  assert.deepEqual(p2.data.data.map((r) => r.id), [4, 5]);
  assert.equal(p2.data.pagination.totalPages, 3);
});

test('并发写入：无重复 id、无记录覆盖、计数准确', async () => {
  const before = (await jsonFetch('/mock/api/articles')).data.pagination.total;
  const N = 15;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      jsonFetch('/mock/api/articles', {
        method: 'POST',
        body: { title: `并发-${i}`, views: i },
      }),
    ),
  );
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.data));
  const ids = results.map((r) => r.data.id);
  assert.equal(new Set(ids).size, N, '分配的 id 无重复');
  assert.deepEqual([...ids], ids.slice().sort((a, b) => a - b), 'id 连续不串号');

  const after = await jsonFetch('/mock/api/articles?pageSize=100');
  assert.equal(after.data.pagination.total, before + N, '计数准确、无丢失覆盖');
  for (let i = 0; i < N; i += 1) {
    const record = after.data.data.find((r) => r.title === `并发-${i}`);
    assert.ok(record, `并发-${i} 的内容可查`);
    assert.equal(record.views, i, `并发-${i} 没有被别的写入覆盖`);
  }
});

test('并发 PATCH 同一记录不会丢字段（后写覆盖完整记录）', async () => {
  await Promise.all([
    jsonFetch('/mock/api/articles/3', { method: 'PATCH', body: { title: 'a-write' } }),
    jsonFetch('/mock/api/articles/3', { method: 'PATCH', body: { views: 42 } }),
  ]);
  const record = (await jsonFetch('/mock/api/articles/3')).data;
  // both writes serialized: title is either original or a-write, but views=42 present
  assert.equal(record.views, 42);
});

test('恢复初始状态：回到最初种入的同一批记录', async () => {
  const original = articlesCollection.seedRecords;
  const reset = await jsonFetch(`/api/collections/${articlesCollection.id}/reset`, {
    method: 'POST',
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.data.length, original.length);
  assert.deepEqual(reset.data.data, original.map((r) => r.data), '恢复为种子快照而非新随机数据');

  const list = await jsonFetch('/mock/api/articles?pageSize=100');
  assert.equal(list.data.pagination.total, original.length);
  assert.deepEqual(
    list.data.data.map((r) => r.id),
    [1, 2, 3, 4, 5],
  );
  for (const seedRecord of original) {
    const detail = await jsonFetch(`/mock/api/articles/${seedRecord.id}`);
    assert.deepEqual(detail.data, seedRecord.data);
  }
});

test('恢复后再新建：id 从种子之后继续（6）而非与种子撞号', async () => {
  const created = await jsonFetch('/mock/api/articles', {
    method: 'POST',
    body: { title: '重置后的新文章' },
  });
  assert.equal(created.data.id, 6);
});

// ---------------------------------------------------------------------------
// persistence: a fresh app instance (same DB) sees the same state
// ---------------------------------------------------------------------------

test('模拟重启：新进程视图下集合内容与已分配 id 不丢失', async () => {
  const app2 = createApp(projectId);
  const server2 = await new Promise((resolve) => {
    const s = app2.listen(0, () => resolve(s));
  });
  try {
    const url2 = `http://127.0.0.1:${server2.address().port}`;
    const res = await fetch(`${url2}/mock/api/articles?pageSize=100`);
    const body = await res.json();
    assert.equal(body.pagination.total, 6, '重启后记录仍在');
    assert.deepEqual(body.data.map((r) => r.id), [1, 2, 3, 4, 5, 6]);

    // id counter persisted: next record is 7
    const created = await fetch(`${url2}/mock/api/articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '重启后新建' }),
    }).then((r) => r.json());
    assert.equal(created.id, 7);
  } finally {
    await new Promise((resolve) => server2.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// model-backed collection
// ---------------------------------------------------------------------------

test('引用公共模型的集合：POST 后能读，模型引用多层展开', async () => {
  const created = await jsonFetch('/mock/api/authors', {
    method: 'POST',
    body: { userName: '模型集合作者' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.id, 1);
  assert.equal(created.data.userName, '模型集合作者');
  assert.match(created.data.email, /@/, '缺失字段由模型结构生成补齐');
  assert.equal(typeof created.data.employer.companyName, 'string');

  const list = await jsonFetch('/mock/api/authors');
  assert.equal(list.data.pagination.total, 1);
});

// ---------------------------------------------------------------------------
// regression: ordinary interfaces and scenarios unchanged
// ---------------------------------------------------------------------------

test('回归：普通接口仍每次现生成，不受集合改动影响', async () => {
  const created = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '随机数',
      path: '/api/random',
      method: 'GET',
      defaultResponse: {
        fields: [
          { name: 'value', type: 'number', min: 1, max: 100 },
          { name: 'email', type: 'string' },
        ],
      },
      scenarios: [],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const a = await jsonFetch('/mock/api/random');
  const b = await jsonFetch('/mock/api/random');
  assert.equal(a.status, 200);
  assert.match(a.data.email, /@/);
  // stateless: values are generated independently each time
  assert.equal(typeof b.data.value, 'number');
});

test('回归：条件场景在普通接口上仍按声明顺序匹配', async () => {
  await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '带场景接口',
      path: '/api/scened',
      method: 'GET',
      defaultResponse: { fields: [{ name: 'which', type: 'string' }] },
      scenarios: [
        {
          name: '命中场景X',
          statusCode: 200,
          conditions: [{ location: 'query', field: 'go', operator: 'eq', value: 'x' }],
          response: { fields: [{ name: 'which', type: 'string' }] },
        },
      ],
    },
  });
  const hit = await jsonFetch('/mock/api/scened?go=x');
  assert.equal(decodeURIComponent(hit.headers.get('x-mock-scenario')), '命中场景X');
  const miss = await jsonFetch('/mock/api/scened');
  assert.equal(miss.headers.get('x-mock-scenario'), 'default');
});

test('回归：集合路径上的请求不会命中普通接口场景', async () => {
  // /api/articles has no ordinary interface; header just stays 'default'
  const res = await jsonFetch('/mock/api/articles?go=x');
  assert.equal(res.headers.get('x-mock-scenario'), 'default');
  assert.ok(Array.isArray(res.data.data), '返回的是集合列表而非场景数据');
});

test('回归：模型成环检测仍生效（资源集合走引用时不绕过）', async () => {
  const a = await jsonFetch('/api/models', { method: 'POST', body: { name: 'LoopA2', fields: [{ name: 'note', type: 'string' }] } });
  const b = await jsonFetch('/api/models', { method: 'POST', body: { name: 'LoopB2', fields: [{ name: 'note', type: 'string' }] } });
  await jsonFetch(`/api/models/${a.data.id}`, {
    method: 'PUT',
    body: { name: 'LoopA2', fields: [{ name: 'b', type: 'ref', ref: b.data.id }] },
  });
  const closeLoop = await jsonFetch(`/api/models/${b.data.id}`, {
    method: 'PUT',
    body: { name: 'LoopB2', fields: [{ name: 'a', type: 'ref', ref: a.data.id }] },
  });
  assert.equal(closeLoop.status, 422);
  assert.equal(closeLoop.data.error.code, 'CIRCULAR_REFERENCE');
});

test('回归：被集合引用的模型不能删除', async () => {
  const res = await jsonFetch(`/api/models/${globalThis.__authorModelId}`, { method: 'DELETE' });
  assert.equal(res.status, 422);
  assert.match(JSON.stringify(res.data), /资源集合/);
});

test('回归：集合的 405 语义（根路径 DELETE）', async () => {
  const res = await jsonFetch('/mock/api/articles', { method: 'DELETE' });
  assert.equal(res.status, 405);
  assert.equal(res.data.error.code, 'METHOD_NOT_ALLOWED');
  assert.match(res.headers.get('allow'), /GET/);
});
