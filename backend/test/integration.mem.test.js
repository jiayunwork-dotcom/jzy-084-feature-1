/**
 * End-to-end style verification against an in-memory PostgreSQL (pg-mem):
 * definition CRUD -> save-time validation -> real HTTP mock dispatch.
 * Skipped automatically unless pg-mem is installed (dev-only dependency).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

let newDb;
try {
  ({ newDb } = await import('pg-mem'));
} catch {
  // pg-mem not installed in this environment
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

// Replace the shared pg Pool instance's methods with an in-memory pool.
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

test('健康检查', async () => {
  const { status, data } = await jsonFetch('/api/health');
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
});

test('创建公共模型 Address 与 User（User 引用 Address）', async () => {
  const address = await jsonFetch('/api/models', {
    method: 'POST',
    body: {
      name: 'Address',
      fields: [
        { name: 'city', type: 'string' },
        { name: 'detail', type: 'string' },
      ],
    },
  });
  assert.equal(address.status, 201, JSON.stringify(address.data));
  const user = await jsonFetch('/api/models', {
    method: 'POST',
    body: {
      name: 'User',
      fields: [
        { name: 'id', type: 'number', min: 1, max: 999 },
        { name: 'userName', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'address', type: 'ref', ref: address.data.id },
      ],
    },
  });
  assert.equal(user.status, 201, JSON.stringify(user.data));
});

test('保存接口：默认响应 + 两个顺序场景', async () => {
  const models = (await jsonFetch('/api/models')).data;
  const userModel = models.find((m) => m.name === 'User');
  const created = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '用户列表',
      path: '/api/users',
      method: 'GET',
      defaultResponse: {
        fields: [
          { name: 'code', type: 'number', min: 0, max: 0 },
          {
            name: 'data',
            type: 'array',
            items: { name: 'user', type: 'ref', ref: userModel.id },
          },
        ],
      },
      scenarios: [
        {
          name: '管理员令牌',
          statusCode: 200,
          conditions: [{ location: 'header', field: 'x-token', operator: 'eq', value: 'admin' }],
          response: {
            fields: [
              { name: 'code', type: 'number', min: 0, max: 0 },
              { name: 'admin', type: 'boolean' },
              { name: 'emails', type: 'array', items: { name: 'email', type: 'string' } },
            ],
          },
        },
        {
          name: 'VIP 查询',
          statusCode: 200,
          conditions: [{ location: 'query', field: 'vip', operator: 'eq', value: 'true' }],
          response: {
            fields: [
              { name: 'code', type: 'number', min: 0, max: 0 },
              { name: 'vip', type: 'boolean' },
            ],
          },
        },
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
});

test('非法路径在保存时被拒绝并返回结构化错误', async () => {
  const res = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '坏路径',
      path: 'api//bad',
      method: 'GET',
      defaultResponse: { fields: [] },
    },
  });
  assert.equal(res.status, 422);
  assert.equal(res.data.error.code, 'VALIDATION_ERROR');
  const messages = res.data.error.details.map((d) => d.message).join(' ');
  assert.match(messages, /斜杠/);
  assert.match(messages, /双斜杠/);
});

test('引用不存在的模型在保存时被拒绝', async () => {
  const res = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '幽灵引用',
      path: '/ghost',
      method: 'GET',
      defaultResponse: {
        fields: [{ name: 'owner', type: 'ref', ref: '00000000-0000-0000-0000-000000000000' }],
      },
    },
  });
  assert.equal(res.status, 422);
  assert.match(JSON.stringify(res.data.error.details), /不存在的模型/);
});

test('路径+方法重复被拒绝；换方法后允许', async () => {
  const dup = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '重复', path: '/api/users', method: 'get',
      defaultResponse: { fields: [{ name: 'x', type: 'boolean' }] },
    },
  });
  assert.equal(dup.status, 422);
  assert.match(JSON.stringify(dup.data.error.details), /GET \/api\/users/);

  const post = await jsonFetch('/api/interfaces', {
    method: 'POST',
    body: {
      name: '创建用户', path: '/api/users', method: 'POST',
      defaultResponse: { fields: [{ name: 'id', type: 'number', min: 1, max: 1 }] },
    },
  });
  assert.equal(post.status, 201, JSON.stringify(post.data));
});

test('循环引用（A<->B）在模型保存时被拒绝并指出成环模型', async () => {
  const a = await jsonFetch('/api/models', {
    method: 'POST',
    body: { name: 'LoopA', fields: [{ name: 'note', type: 'string' }] },
  });
  const b = await jsonFetch('/api/models', {
    method: 'POST',
    body: { name: 'LoopB', fields: [{ name: 'note', type: 'string' }] },
  });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const linkA = await jsonFetch(`/api/models/${a.data.id}`, {
    method: 'PUT',
    body: { name: 'LoopA', fields: [{ name: 'b', type: 'ref', ref: b.data.id }] },
  });
  assert.equal(linkA.status, 200);

  const closeLoop = await jsonFetch(`/api/models/${b.data.id}`, {
    method: 'PUT',
    body: { name: 'LoopB', fields: [{ name: 'a', type: 'ref', ref: a.data.id }] },
  });
  assert.equal(closeLoop.status, 422);
  assert.equal(closeLoop.data.error.code, 'CIRCULAR_REFERENCE');
  assert.match(closeLoop.data.error.details[0].message, /LoopA/);
  assert.match(closeLoop.data.error.details[0].message, /LoopB/);
});

test('请求 Mock 端点：默认响应含可信假数据且模型引用多层展开', async () => {
  const res = await jsonFetch('/mock/api/users');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-mock-scenario'), 'default');
  assert.equal(res.data.code, 0);
  assert.ok(Array.isArray(res.data.data));
  assert.ok(res.data.data.length >= 1 && res.data.data.length <= 5);
  const user = res.data.data[0];
  assert.match(user.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  assert.equal(typeof user.userName, 'string');
  assert.ok(user.id >= 1 && user.id <= 999);
  assert.equal(typeof user.address.city, 'string');
  assert.equal(typeof user.address.detail, 'string');
});

test('条件场景按声明顺序：带 token 时命中第一套，即使 vip=true', async () => {
  const res = await jsonFetch('/mock/api/users?vip=true', {
    headers: { 'Content-Type': 'application/json', 'x-token': 'admin' },
  });
  assert.equal(res.status, 200);
  assert.equal(decodeURIComponent(res.headers.get('x-mock-scenario')), '管理员令牌');
  assert.equal(typeof res.data.admin, 'boolean');
  assert.ok(Array.isArray(res.data.emails));
  assert.match(res.data.emails[0], /@/);
});

test('无 token 但 vip=true 时命中第二套', async () => {
  const res = await jsonFetch('/mock/api/users?vip=true');
  assert.equal(decodeURIComponent(res.headers.get('x-mock-scenario')), 'VIP 查询');
  assert.equal(typeof res.data.vip, 'boolean');
});

test('无任何条件命中时回退默认响应', async () => {
  const res = await jsonFetch('/mock/api/users?foo=bar');
  assert.equal(res.headers.get('x-mock-scenario'), 'default');
  assert.ok(Array.isArray(res.data.data));
});

test('未定义的 Mock 路径返回 404', async () => {
  const res = await jsonFetch('/mock/nope/missing');
  assert.equal(res.status, 404);
  assert.equal(res.data.error.code, 'MOCK_NOT_FOUND');
});
