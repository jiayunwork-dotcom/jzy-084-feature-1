/**
 * Stateful resource collection — end-to-end verification against an in-memory
 * PostgreSQL (pg-mem): definition save -> seed -> write/read sequences,
 * id stability, generated-once stability, concurrent writes, reset and
 * persistence (re-dispatch after a "restart", same DB).
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
import { initSchema } from '../src/db/schema.js';
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

before(async () => {
  await initSchema();
  const projectId = '00000000-0000-0000-0000-000000000001';
  await pool.query(`INSERT INTO projects (id, name) VALUES ($1, '资源测试项目')`, [projectId]);
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
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, headers: res.headers, data };
}

const mock = (path, options = {}) => jsonFetch(`/mock${path}`, options);

let resourceId;
const resourceFields = [
  { name: 'id', type: 'number' },
  { name: 'title', type: 'string' },
  { name: 'author', type: 'string' },
  { name: 'email', type: 'string' },
  { name: 'category', type: 'enum', values: ['tech', 'life', 'news'] },
  { name: 'viewCount', type: 'number', min: 0, max: 999 },
  { name: 'published', type: 'boolean' },
];

test('保存资源集合接口（记录结构就地定义）', async () => {
  const res = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '文章集合',
      path: '/api/articles',
      method: 'GET',
      kind: 'resource',
      resourceConfig: {
        fields: resourceFields,
        seedCount: 3,
        idField: 'id',
        pageSize: 2,
      },
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.kind, 'resource');
  assert.equal(res.data.resourceConfig.seedCount, 3);
  resourceId = res.data.id;
});

test('种子在首次读取时生成并固定：两次列表内容完全一致', async () => {
  const first = await mock('/api/articles');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-mock-mode'), 'resource');
  assert.equal(first.data.data.length, 2); // pageSize = 2
  assert.equal(first.data.pagination.total, 3);
  assert.equal(first.data.pagination.totalPages, 2);

  const second = await mock('/api/articles?page=1&pageSize=100');
  const third = await mock('/api/articles?page=1&pageSize=100');
  assert.deepEqual(second.data.data, third.data.data);
  assert.equal(second.data.data.length, 3);
  // 种子 id 为 1..3
  assert.deepEqual(second.data.data.map((r) => r.id), [1, 2, 3]);
  // 字段形态正确
  for (const record of second.data.data) {
    assert.equal(typeof record.title, 'string');
    assert.match(record.email, /@/);
    assert.ok(['tech', 'life', 'news'].includes(record.category));
    assert.equal(typeof record.published, 'boolean');
  }
});

test('翻页：第二页返回剩余记录且与第一页不重叠', async () => {
  const page1 = await mock('/api/articles?page=1&pageSize=2');
  const page2 = await mock('/api/articles?page=2&pageSize=2');
  assert.equal(page1.data.data.length, 2);
  assert.equal(page2.data.data.length, 1);
  const ids = [...page1.data.data.map((r) => r.id), ...page2.data.data.map((r) => r.id)];
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 2, 3]);
});

test('按字段值精确过滤（含枚举），保留参数不参与过滤', async () => {
  const all = (await mock('/api/articles?pageSize=100')).data.data;
  const target = all[0];
  const filtered = await mock(`/api/articles?category=${encodeURIComponent(target.category)}&pageSize=100`);
  assert.ok(filtered.data.data.every((r) => r.category === target.category));
  assert.ok(filtered.data.data.some((r) => r.id === target.id));
});

test('按 id 取详情返回同一条的完整内容；不存在给出结构化未找到错误', async () => {
  const list = (await mock('/api/articles?pageSize=100')).data.data;
  const detail = await mock('/api/articles/1');
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.data, list.find((r) => r.id === 1));

  const missing = await mock('/api/articles/99999');
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error.code, 'RESOURCE_NOT_FOUND');
  assert.equal(missing.data.error.resourceId, '99999');
});

test('“生成一次”的字段：同一条记录未更新时历次读取值完全相同', async () => {
  const a = (await mock('/api/articles/2')).data;
  const b = (await mock('/api/articles/2')).data;
  const c = (await mock('/api/articles/2')).data;
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test('新建：并入请求体字段、补齐缺失字段、分配稳定 id 且随后可读', async () => {
  const created = await mock('/api/articles', {
    method: 'POST',
    body: { title: '我的新文章', category: 'news', viewCount: 42 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.headers.get('x-mock-mode'), 'resource');
  assert.match(created.headers.get('location') || '', /\/api\/articles\/4$/);
  assert.equal(created.data.id, 4);
  assert.equal(created.data.title, '我的新文章');
  assert.equal(created.data.category, 'news');
  assert.equal(created.data.viewCount, 42);
  // 未提供的字段由同一套生成器补齐
  assert.match(created.data.email, /@/);
  assert.equal(typeof created.data.published, 'boolean');

  // 列表能看到
  const list = (await mock('/api/articles?pageSize=100')).data.data;
  assert.ok(list.some((r) => r.id === 4));
  assert.equal(list.length, 4);
  // 按新 id 取详情读到的就是它
  const detail = await mock('/api/articles/4');
  assert.deepEqual(detail.data, created.data);
});

test('新建时请求体自带 id 无法占用平台标识', async () => {
  const created = await mock('/api/articles', {
    method: 'POST',
    body: { id: 999, title: '伪造 id' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.id, 5);
  const ghost = await mock('/api/articles/999');
  assert.equal(ghost.status, 404);
});

test('PATCH 局部修改：改到的字段变新值，其余字段纹丝不动', async () => {
  const before = (await mock('/api/articles/1')).data;
  const patched = await mock('/api/articles/1', {
    method: 'PATCH',
    body: { viewCount: 123 },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.viewCount, 123);
  assert.equal(patched.data.id, 1);
  for (const [key, value] of Object.entries(before)) {
    if (key === 'viewCount') continue;
    assert.deepEqual(patched.data[key], value, `字段 ${key} 不应被 PATCH 改动`);
  }
  // 再读确认持久
  assert.equal((await mock('/api/articles/1')).data.viewCount, 123);
});

test('PUT 整体替换：未给字段重新生成，标识保持不变', async () => {
  const replaced = await mock('/api/articles/2', {
    method: 'PUT',
    body: { title: '全新标题', category: 'life' },
  });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.data.id, 2);
  assert.equal(replaced.data.title, '全新标题');
  assert.equal(replaced.data.category, 'life');
  assert.match(replaced.data.email, /@/);
  assert.ok(typeof replaced.data.viewCount === 'number');

  const stored = (await mock('/api/articles/2')).data;
  assert.deepEqual(stored, replaced.data);
  // 其它记录未受影响
  assert.equal((await mock('/api/articles/1')).data.viewCount, 123);
});

test('PUT/PATCH 不存在的 id 返回 404 而不是凭空造一条', async () => {
  const put = await mock('/api/articles/777', { method: 'PUT', body: { title: 'x' } });
  assert.equal(put.status, 404);
  assert.equal(put.data.error.code, 'RESOURCE_NOT_FOUND');
  const patch = await mock('/api/articles/777', { method: 'PATCH', body: { title: 'x' } });
  assert.equal(patch.status, 404);
});

test('写读混合序列后最终状态等于此前所有写操作的累计结果', async () => {
  // 当前：1(patched vc=123), 2(replaced 全新标题/life), 3(seed untouched),
  //       4(我的新文章/news), 5(伪造 id 尝试 -> id 5), 另含种子共 5 条
  // 再删 3、新建 1 条
  const del = await mock('/api/articles/3', { method: 'DELETE' });
  assert.equal(del.status, 204);
  const created = await mock('/api/articles', { method: 'POST', body: { title: '第六篇' } });
  assert.equal(created.data.id, 6);

  const list = (await mock('/api/articles?pageSize=100')).data.data;
  assert.deepEqual(list.map((r) => r.id), [1, 2, 4, 5, 6]);
  assert.equal(list.find((r) => r.id === 1).viewCount, 123);
  assert.equal(list.find((r) => r.id === 2).title, '全新标题');
  assert.equal(list.find((r) => r.id === 4).title, '我的新文章');

  // 删除后按 id 查详情为未找到，列表里没有
  const goneDetail = await mock('/api/articles/3');
  assert.equal(goneDetail.status, 404);
  assert.ok(!list.some((r) => r.id === 3));
  // 删除不存在的 id 同样 404
  const delAgain = await mock('/api/articles/3', { method: 'DELETE' });
  assert.equal(delAgain.status, 404);
});

test('标识稳定不漂移：其它记录增删后既有 id 仍指向同一条内容', async () => {
  const record4Before = (await mock('/api/articles/4')).data;
  // 删除 5、新增 7
  await mock('/api/articles/5', { method: 'DELETE' });
  const added = await mock('/api/articles', { method: 'POST', body: { title: '漂移测试' } });
  assert.equal(added.data.id, 7);
  const record4After = (await mock('/api/articles/4')).data;
  assert.deepEqual(record4After, record4Before);
});

test('并发写入：20 个并发 POST 不产生重复标识、不丢记录、计数正确', async () => {
  const before = (await mock('/api/articles?pageSize=100')).data.pagination.total;
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      mock('/api/articles', { method: 'POST', body: { title: `并发 ${i}` } }),
    ),
  );
  for (const res of results) assert.equal(res.status, 201, JSON.stringify(res.data));
  const ids = results.map((r) => r.data.id);
  assert.equal(new Set(ids).size, 20, '标识必须全不重复');
  const after = await mock('/api/articles?pageSize=100');
  assert.equal(after.data.pagination.total, before + 20);
  const allIds = after.data.data.map((r) => r.id);
  assert.equal(new Set(allIds).size, allIds.length, '集合内不得有重复 id');
});

test('集合路由上不支持的方法返回结构化 405 与 Allow', async () => {
  const onCollection = await mock('/api/articles', { method: 'PATCH', body: {} });
  assert.equal(onCollection.status, 405);
  assert.equal(onCollection.data.error.code, 'METHOD_NOT_ALLOWED');
  assert.match(onCollection.headers.get('allow'), /GET, POST/);
  const onItem = await mock('/api/articles/1', { method: 'POST', body: {} });
  assert.equal(onItem.status, 405);
  assert.match(onItem.headers.get('allow'), /PUT/);
});

test('非法请求体（数组/原始值）返回结构化 400', async () => {
  const res = await mock('/api/articles', { method: 'POST', body: [1, 2, 3] });
  assert.equal(res.status, 400);
  assert.equal(res.data.error.code, 'INVALID_REQUEST_BODY');
});

test('条件场景优先于集合读写：命中时返回场景响应，未命中回归集合', async () => {
  // 给资源集合加一个场景：query debug=1 时返回固定结构
  const current = await jsonFetch(`/api/interfaces/${resourceId}`);
  const config = current.data.resourceConfig;
  const updated = await jsonFetch(`/api/interfaces/${resourceId}`, {
    method: 'PUT',
    body: {
      name: '文章集合',
      path: '/api/articles',
      method: 'GET',
      kind: 'resource',
      resourceConfig: config,
      scenarios: [
        {
          name: '调试场景',
          statusCode: 200,
          conditions: [{ location: 'query', field: 'debug', operator: 'eq', value: '1' }],
          response: { fields: [{ name: 'debug', type: 'boolean' }, { name: 'note', type: 'string' }] },
        },
      ],
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));

  // 更新定义后状态被重置：重新播种
  const seeded = await mock('/api/articles?pageSize=100');
  assert.equal(seeded.data.pagination.total, 3);

  const hit = await mock('/api/articles?debug=1');
  assert.equal(hit.status, 200);
  assert.equal(decodeURIComponent(hit.headers.get('x-mock-scenario')), '调试场景');
  assert.equal(hit.headers.get('x-mock-mode'), 'scenario');
  assert.equal(typeof hit.data.debug, 'boolean');
  assert.equal(Array.isArray(hit.data.data), false);

  // 未命中场景：集合语义照常
  const normal = await mock('/api/articles?pageSize=100');
  assert.equal(normal.headers.get('x-mock-mode'), 'resource');
  assert.equal(normal.data.pagination.total, 3);
});

test('管理 API：一键恢复初始种子后内容回到最初批次', async () => {
  // 先制造一些变更
  await mock('/api/articles', { method: 'POST', body: { title: '待清除' } });
  await mock('/api/articles/1', { method: 'PATCH', body: { title: '改了又改' } });
  const dirty = await mock('/api/articles?pageSize=100');
  assert.ok(dirty.data.pagination.total > 3);

  const reset = await jsonFetch(`/api/interfaces/${resourceId}/resource-reset`, {
    method: 'POST',
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.equal(reset.data.reset, true);
  assert.equal(reset.data.total, 3);

  const list = (await mock('/api/articles?pageSize=100')).data;
  assert.equal(list.pagination.total, 3);
  assert.deepEqual(list.data.map((r) => r.id), [1, 2, 3]);
  // 第一条回到种子值（PATCH 被抹掉）
  assert.notEqual(list.data[0].title, '改了又改');

  // 新建继续在种子之后分配，不复用被删 id
  const created = await mock('/api/articles', { method: 'POST', body: { title: '重置后新建' } });
  assert.equal(created.data.id, 4);
});

test('资源集合状态查询返回实时计数', async () => {
  const state = await jsonFetch(`/api/interfaces/${resourceId}/resource-state`);
  assert.equal(state.status, 200);
  assert.equal(state.data.initialized, true);
  assert.equal(state.data.total, 4); // 3 seeds + 1 created
  assert.equal(state.data.seedCount, 3);
});

test('种子记录可引用公共模型并多层展开，且展开结果只生成一次、历次读取一致', async () => {
  const company = await jsonFetch('/api/models', {
    method: 'POST',
    body: {
      name: 'CompanyX',
      fields: [
        { name: 'companyName', type: 'string' },
        { name: 'website', type: 'string' },
      ],
    },
  });
  assert.equal(company.status, 201);
  const employee = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '员工集合',
      path: '/api/employees',
      method: 'GET',
      kind: 'resource',
      resourceConfig: {
        fields: [
          { name: 'id', type: 'number' },
          { name: 'userName', type: 'string' },
          { name: 'employer', type: 'ref', ref: company.data.id },
        ],
        seedCount: 2,
        idField: 'id',
        pageSize: 10,
      },
    },
  });
  assert.equal(employee.status, 201, JSON.stringify(employee.data));

  const a = (await mock('/api/employees/1')).data;
  const b = (await mock('/api/employees/1')).data;
  assert.equal(typeof a.employer, 'object');
  assert.equal(typeof a.employer.companyName, 'string');
  assert.match(a.employer.website, /^https:\/\//);
  // 多层模型引用的展开结果同样只生成一次
  assert.deepEqual(a, b);
});

test('持久化：模拟重启（重建 app、不清库）后内容与已分配标识不丢失', async () => {
  // 记下当前全部数据
  const before = (await mock('/api/articles?pageSize=100')).data.data;
  const app2 = createApp('00000000-0000-0000-0000-000000000001');
  const server2 = await new Promise((resolve) => {
    const s = app2.listen(0, () => resolve(s));
  });
  const url2 = `http://127.0.0.1:${server2.address().port}`;
  try {
    const res = await fetch(`${url2}/mock/api/articles?pageSize=100`);
    const after = (await res.json()).data;
    assert.deepEqual(after, before);
    // 计数器也持久化：下一条 id 继续递增
    const created = await fetch(`${url2}/mock/api/articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '重启后' }),
    });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.id, 5);
  } finally {
    server2.close();
  }
});
