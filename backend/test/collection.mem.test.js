/**
 * Stateful resource collections — full HTTP integration against in-memory
 * PostgreSQL (pg-mem). Locks the correctness baselines:
 *  - write/read sequences observe the accumulated state of all prior writes
 *  - ids stay stable once allocated and are never reused or shifted
 *  - generate-once fields read identically until explicitly updated
 *  - concurrent writers never get duplicate ids or lose records
 *  - reset restores the exact initial seed batch
 *  - scenarios take precedence over collection reads/writes
 *  - stateless interfaces / uniqueness / cycle detection are unaffected
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
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, headers: res.headers, data };
}

const itemRecord = {
  type: 'object',
  fields: [
    { name: 'title', type: 'string' },
    { name: 'price', type: 'number', min: 1, max: 999 },
    { name: 'status', type: 'enum', values: ['on_sale', 'off_sale'] },
    { name: 'owner', type: 'object', fields: [{ name: 'userName', type: 'string' }] },
  ],
};

function collectionPayload(name, path, method, overrides = {}) {
  const { collection, scenarios, ...rest } = overrides;
  return {
    name,
    path,
    method,
    kind: 'collection',
    ...rest,
    collection: {
      collectionKey: 'items',
      idField: 'id',
      seedCount: 5,
      record: itemRecord,
      ...(collection || {}),
    },
    scenarios: scenarios || [],
  };
}

test('准备：保存集合的六个 CRUD 端点', async () => {
  const endpoints = [
    ['列表', '/api/items', 'GET'],
    ['详情', '/api/items/:id', 'GET'],
    ['新建', '/api/items', 'POST'],
    ['整体替换', '/api/items/:id', 'PUT'],
    ['局部修改', '/api/items/:id', 'PATCH'],
    ['删除', '/api/items/:id', 'DELETE'],
  ];
  for (const [name, path, method] of endpoints) {
    const res = await jsonFetch('/api/interfaces', {
      method: 'POST',
      body: collectionPayload(`商品${name}`, path, method),
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.kind, 'collection');
    assert.equal(res.data.collection.collectionKey, 'items');
  }
});

test('准备：同一 collectionKey 的记录结构不一致被拒绝', async () => {
  const res = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: collectionPayload('不一致的集合', '/api/items2', 'GET', {
      collection: {
        record: { type: 'object', fields: [{ name: 'other', type: 'string' }] },
      },
    }),
  });
  // 路径不冲突，但 collectionKey 与已有接口共享而结构不同
  assert.equal(res.status, 422);
  assert.match(JSON.stringify(res.data.error.details), /完全一致/);
});

test('准备：集合接口的路径+方法唯一性校验仍然生效', async () => {
  const res = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: collectionPayload('重复端点', '/api/items', 'GET'),
  });
  assert.equal(res.status, 422);
  assert.match(JSON.stringify(res.data.error.details), /GET \/api\/items/);
});

let seedList;

test('首次访问自动种入 5 条记录；连续两次取列表内容完全一致', async () => {
  const first = await jsonFetch('/mock/api/items');
  assert.equal(first.status, 200);
  assert.equal(first.data.total, 5);
  assert.equal(first.data.page, 1);
  assert.equal(first.data.pageSize, 20);
  assert.equal(first.data.list.length, 5);
  assert.deepEqual(first.data.list.map((r) => r.id), [1, 2, 3, 4, 5]);
  for (const record of first.data.list) {
    assert.equal(typeof record.title, 'string');
    assert.ok(['on_sale', 'off_sale'].includes(record.status));
    assert.equal(typeof record.owner.userName, 'string');
  }
  const second = await jsonFetch('/mock/api/items');
  assert.deepEqual(second.data, first.data, '集合未被改动时两次读取必须一致');
  seedList = first.data.list;
});

test('列表支持分页与按字段值过滤', async () => {
  const page2 = await jsonFetch('/mock/api/items?page=2&pageSize=2');
  assert.equal(page2.data.total, 5);
  assert.equal(page2.data.list.length, 2);
  assert.deepEqual(page2.data.list.map((r) => r.id), [3, 4]);

  const target = seedList[0];
  const filtered = await jsonFetch(`/mock/api/items?status=${target.status}`);
  assert.ok(filtered.data.total >= 1);
  assert.ok(filtered.data.list.every((r) => r.status === target.status));
  assert.ok(filtered.data.list.some((r) => r.id === target.id));
});

test('按 id 取详情；不存在的 id 返回结构化未找到错误', async () => {
  const detail = await jsonFetch('/mock/api/items/2');
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.data, seedList[1]);

  const missing = await jsonFetch('/mock/api/items/999');
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error.code, 'RECORD_NOT_FOUND');
  assert.match(missing.data.error.message, /999/);
});

let createdId;
let createdRecord;

test('新建：分配稳定 id，未提供的字段被生成补齐，之后列表与详情都能读到', async () => {
  const created = await jsonFetch('/mock/api/items', {
    method: 'POST',
    body: { title: '手写标题', id: 999 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.id, 6, '平台分配的 id 覆盖请求体里的 id');
  assert.equal(created.data.title, '手写标题');
  assert.ok(['on_sale', 'off_sale'].includes(created.data.status), '缺失字段被生成补齐');
  createdId = created.data.id;
  createdRecord = created.data;

  const list = await jsonFetch('/mock/api/items');
  assert.equal(list.data.total, 6);
  assert.ok(list.data.list.some((r) => r.id === createdId));

  const detail = await jsonFetch(`/mock/api/items/${createdId}`);
  assert.deepEqual(detail.data, createdRecord);
});

test('生成一次的字段在未更新时历次读取完全一致', async () => {
  for (let i = 0; i < 3; i += 1) {
    const again = await jsonFetch(`/mock/api/items/${createdId}`);
    assert.deepEqual(again.data, createdRecord, '未显式更新时读取结果不得重新随机');
  }
});

test('整体替换 PUT：精确改到目标记录，id 不变，其它记录纹丝不动', async () => {
  const replaced = await jsonFetch(`/mock/api/items/${createdId}`, {
    method: 'PUT',
    body: { title: '替换后的标题' },
  });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.data.id, createdId);
  assert.equal(replaced.data.title, '替换后的标题');

  const detail = await jsonFetch(`/mock/api/items/${createdId}`);
  assert.deepEqual(detail.data, replaced.data, '改完再取必须读到新值');

  const neighbor = await jsonFetch('/mock/api/items/2');
  assert.deepEqual(neighbor.data, seedList[1], '其它记录不得受影响');
});

test('局部修改 PATCH：只改给定字段，其余保持', async () => {
  const before = (await jsonFetch(`/mock/api/items/${createdId}`)).data;
  const patched = await jsonFetch(`/mock/api/items/${createdId}`, {
    method: 'PATCH',
    body: { price: 12345 },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.price, 12345);
  assert.equal(patched.data.title, before.title, '未提及的字段保持原值');
  assert.equal(patched.data.id, createdId);

  const detail = await jsonFetch(`/mock/api/items/${createdId}`);
  assert.deepEqual(detail.data, patched.data);
});

test('更新/删除不存在的记录返回结构化 404', async () => {
  const put = await jsonFetch('/mock/api/items/999', { method: 'PUT', body: { title: 'x' } });
  assert.equal(put.status, 404);
  assert.equal(put.data.error.code, 'RECORD_NOT_FOUND');
  const del = await jsonFetch('/mock/api/items/999', { method: 'DELETE' });
  assert.equal(del.status, 404);
  assert.equal(del.data.error.code, 'RECORD_NOT_FOUND');
});

test('标识稳定：其它记录增删后，既有记录的 id 与内容不漂移、不复用', async () => {
  const beforeTwo = (await jsonFetch('/mock/api/items/2')).data;

  // 删掉一条，再新建一条，都不应影响记录 2
  const del = await jsonFetch('/mock/api/items/3', { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(del.data.deleted, true);

  const created = await jsonFetch('/mock/api/items', { method: 'POST', body: {} });
  assert.equal(created.status, 201);
  assert.ok(created.data.id > 6, 'id 单调递增，已删除记录的 id 不复用');

  const afterTwo = await jsonFetch('/mock/api/items/2');
  assert.deepEqual(afterTwo.data, beforeTwo, '其它记录的增删不得改变本记录');

  const gone = await jsonFetch('/mock/api/items/3');
  assert.equal(gone.status, 404, '删除后按 id 取详情必须未找到');

  const list = await jsonFetch('/mock/api/items');
  assert.ok(!list.data.list.some((r) => r.id === 3), '删除后列表里不得再出现');
});

test('并发写入：20 个并发新建不产生重复 id、不丢记录', async () => {
  const before = (await jsonFetch('/mock/api/items')).data.total;
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      jsonFetch('/mock/api/items', { method: 'POST', body: { title: `并发${i}` } }),
    ),
  );
  for (const res of results) {
    assert.equal(res.status, 201, JSON.stringify(res.data));
  }
  const ids = results.map((r) => r.data.id);
  assert.equal(new Set(ids).size, 20, '并发分配不得出现重复 id');

  const afterList = await jsonFetch('/mock/api/items?pageSize=100');
  assert.equal(afterList.data.total, before + 20, '计数必须对得上，不得相互覆盖');
  for (const id of ids) {
    const detail = await jsonFetch(`/mock/api/items/${id}`);
    assert.equal(detail.status, 200, `新建的记录 ${id} 必须可读`);
  }
});

test('并发混合写入：并发新建 + 并发修改同一记录后状态仍然自洽', async () => {
  const before = (await jsonFetch('/mock/api/items')).data.total;
  const creates = Array.from({ length: 10 }, (_, i) =>
    jsonFetch('/mock/api/items', { method: 'POST', body: { title: `混合并发${i}` } }),
  );
  const patches = Array.from({ length: 10 }, (_, i) =>
    jsonFetch('/mock/api/items/1', { method: 'PATCH', body: { price: 1000 + i } }),
  );
  const results = await Promise.all([...creates, ...patches]);

  const createdIds = results.slice(0, 10).map((r) => {
    assert.equal(r.status, 201);
    return r.data.id;
  });
  assert.equal(new Set(createdIds).size, 10, '混合并发下 id 仍不得重复');

  for (const res of results.slice(10)) {
    assert.equal(res.status, 200);
    assert.equal(res.data.id, 1, '并发修改不得改变目标记录的 id');
  }

  const afterList = await jsonFetch('/mock/api/items?pageSize=100');
  assert.equal(afterList.data.total, before + 10, '混合并发后计数必须对得上');

  const recordOne = await jsonFetch('/mock/api/items/1');
  assert.equal(recordOne.status, 200);
  assert.ok(recordOne.data.price >= 1000 && recordOne.data.price <= 1009,
    '并发 PATCH 后记录 1 应是其中一次写入的值（last-writer-wins），不得损坏');
});

test('恢复初始状态：集合回到最初种入的那一批，计数器一并回退', async () => {
  const reset = await jsonFetch('/api/collections/items/reset', { method: 'POST' });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.reset, true);
  assert.equal(reset.data.recordCount, 5);

  const list = await jsonFetch('/mock/api/items');
  assert.deepEqual(list.data.list, seedList, '恢复后内容必须等于最初种子批次');

  // 种子之后分配过的 id 全部失效；恢复后新记录从种子计数器继续分配
  const recreated = await jsonFetch('/mock/api/items', { method: 'POST', body: {} });
  assert.equal(recreated.data.id, 6, '恢复后 id 计数器回到种子结束处');
});

test('条件场景优先于集合读写：命中场景返回静态响应且不触碰集合', async () => {
  // 给列表端点追加一个场景
  const interfaces = (await jsonFetch('/api/interfaces')).data;
  const listApi = interfaces.find((api) => api.path === '/api/items' && api.method === 'GET');
  const updated = await jsonFetch(`/api/interfaces/${listApi.id}`, {
    method: 'PUT',
    body: collectionPayload('商品列表', '/api/items', 'GET', {
      scenarios: [
        {
          name: '模拟空列表',
          statusCode: 200,
          conditions: [{ location: 'query', field: 'empty', operator: 'eq', value: 'true' }],
          response: { fields: [{ name: 'list', type: 'array', items: { name: 'x', type: 'string' } }] },
        },
      ],
    }),
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));

  const scenarioHit = await jsonFetch('/mock/api/items?empty=true');
  assert.equal(scenarioHit.status, 200);
  assert.equal(decodeURIComponent(scenarioHit.headers.get('x-mock-scenario')), '模拟空列表');
  assert.ok(Array.isArray(scenarioHit.data.list), '命中场景时返回场景静态响应');

  const normal = await jsonFetch('/mock/api/items');
  assert.equal(normal.data.total, 6, '场景未命中时集合内容不受场景影响');
  assert.equal(normal.headers.get('x-mock-scenario'), 'default');
});

test('普通接口回归：无状态接口仍然每次现生成、互不相干', async () => {
  const created = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '无状态对照',
      path: '/plain/random',
      method: 'GET',
      defaultResponse: { fields: [{ name: 'nonce', type: 'string' }] },
    },
  });
  assert.equal(created.status, 201);
  const one = await jsonFetch('/mock/plain/random');
  const two = await jsonFetch('/mock/plain/random');
  assert.equal(one.status, 200);
  assert.notDeepEqual(one.data, two.data, '无状态接口每次请求重新随机');
});

test('集合管理接口：列表展示集合状态；未知集合恢复返回 404', async () => {
  const list = await jsonFetch('/api/collections');
  assert.equal(list.status, 200);
  const items = list.data.find((c) => c.collectionKey === 'items');
  assert.ok(items, '管理列表里应能看到 items 集合');
  assert.equal(items.seeded, true);
  assert.equal(items.recordCount, 6);
  assert.equal(items.interfaces.length, 6);

  const missing = await jsonFetch('/api/collections/ghost/reset', { method: 'POST' });
  assert.equal(missing.status, 404);
});

test('集合状态不依赖应用内存：重建应用实例后内容依旧对得上', async () => {
  const before = (await jsonFetch('/mock/api/items')).data;
  // 模拟“重启”：用同一个数据库再起一个全新的应用实例
  const app2 = createApp(projectId);
  const server2 = app2.listen(0);
  await new Promise((resolve) => server2.once('listening', resolve));
  try {
    const port = server2.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/mock/api/items`);
    const data = await res.json();
    assert.deepEqual(data, before, '状态持久化在数据库中，重启后内容不丢失');
  } finally {
    server2.close();
  }
});

test('模型删除保护：被集合记录结构引用的模型不可删除', async () => {
  const model = await jsonFetch('/api/models', {
    method: 'POST',
    body: { name: 'Product', fields: [{ name: 'title', type: 'string' }] },
  });
  assert.equal(model.status, 201);
  const api = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '产品列表',
      path: '/api/products',
      method: 'GET',
      kind: 'collection',
      collection: {
        collectionKey: 'products',
        idField: 'id',
        seedCount: 2,
        record: { type: 'ref', ref: model.data.id },
      },
    },
  });
  assert.equal(api.status, 201, JSON.stringify(api.data));

  const del = await jsonFetch(`/api/models/${model.data.id}`, { method: 'DELETE' });
  assert.equal(del.status, 422);
  assert.match(JSON.stringify(del.data.error.details), /资源集合记录结构引用/);
});

test('模型引用集合：按模型结构种子生成并正常读写', async () => {
  const list = await jsonFetch('/mock/api/products');
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 2);
  assert.equal(typeof list.data.list[0].title, 'string');
  assert.equal(list.data.list[0].id, 1);

  const created = await jsonFetch('/mock/api/products', {
    method: 'POST',
    body: { title: '新产品' },
  });
  // POST /api/products 未定义 -> 404（只有 GET 被定义为集合接口）
  assert.equal(created.status, 404);
});

test('成环检测回归：模型互相引用仍在保存时被拦截', async () => {
  const a = await jsonFetch('/api/models', {
    method: 'POST',
    body: { name: 'CycA', fields: [{ name: 'note', type: 'string' }] },
  });
  const b = await jsonFetch('/api/models', {
    method: 'POST',
    body: { name: 'CycB', fields: [{ name: 'note', type: 'string' }] },
  });
  await jsonFetch(`/api/models/${a.data.id}`, {
    method: 'PUT',
    body: { name: 'CycA', fields: [{ name: 'b', type: 'ref', ref: b.data.id }] },
  });
  const closeLoop = await jsonFetch(`/api/models/${b.data.id}`, {
    method: 'PUT',
    body: { name: 'CycB', fields: [{ name: 'a', type: 'ref', ref: a.data.id }] },
  });
  assert.equal(closeLoop.status, 422);
  assert.equal(closeLoop.data.error.code, 'CIRCULAR_REFERENCE');
});
