import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSeedRecords,
  generateRecord,
  buildRecordFromBody,
  applyFullReplacement,
  applyPartialUpdate,
  knownFieldNames,
} from '../src/mock/resource-schema.js';

const models = new Map([
  ['company', { id: 'company', name: 'Company', fields: [
    { name: 'companyName', type: 'string' },
  ] }],
]);

const schema = {
  source: 'inline',
  fields: [
    { name: 'id', type: 'number', min: 1, max: 999 },
    { name: 'title', type: 'string' },
    { name: 'email', type: 'string' },
    { name: 'views', type: 'number', min: 0, max: 100 },
    { name: 'status', type: 'enum', values: ['draft', 'published'] },
    { name: 'employer', type: 'ref', ref: 'company' },
  ],
};

test('种入记录沿用同一套生成器：字段语义、枚举、嵌套引用都展开', () => {
  const [first] = generateSeedRecords(schema, 1, models);
  assert.equal(first.id, 1);
  assert.equal(typeof first.data.title, 'string');
  assert.match(first.data.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  assert.ok(['draft', 'published'].includes(first.data.status));
  assert.equal(typeof first.data.employer.companyName, 'string', '引用模型应展开');
});

test('平台分配的稳定 id 覆盖 schema 中同名字段', () => {
  const record = generateRecord(schema, models, 7);
  assert.equal(record.id, 7, '无论 schema 如何生成 id，一律使用平台标识');
});

test('种入批次 id 从 1 连续分配', () => {
  const seed = generateSeedRecords(schema, 5, models);
  assert.deepEqual(seed.map((r) => r.id), [1, 2, 3, 4, 5]);
});

test('新建：请求体字段并入，缺失字段用生成器补齐', () => {
  const record = buildRecordFromBody(schema, models, 3, {
    title: '我是前端传入的标题',
    status: 'published',
    unknown: '被忽略',
    id: 999,
  });
  assert.equal(record.id, 3, '请求体无法改写平台 id');
  assert.equal(record.title, '我是前端传入的标题');
  assert.equal(record.status, 'published');
  assert.match(record.email, /@/, '未提供的 email 由生成器补齐');
  assert.ok(!('unknown' in record), '未知字段被忽略');
});

test('PUT 整体替换：未给字段置 null，id 不变', () => {
  const current = buildRecordFromBody(schema, models, 4, {});
  const replaced = applyFullReplacement(current, { title: '新标题' }, schema);
  assert.equal(replaced.id, 4);
  assert.equal(replaced.title, '新标题');
  assert.equal(replaced.email, null, '未出现的字段被置空');
  assert.equal(replaced.views, null);
  assert.equal(replaced.employer, null);
});

test('PUT 无法通过请求体改写 id', () => {
  const current = { id: 5, title: 'a' };
  const replaced = applyFullReplacement(current, { id: 99, title: 'b' }, schema);
  assert.equal(replaced.id, 5);
});

test('PATCH 局部修改：只改传入字段，其余字段（含生成值）原样保留', () => {
  const current = buildRecordFromBody(schema, models, 6, {});
  const snapshot = JSON.parse(JSON.stringify(current));
  const patched = applyPartialUpdate(current, { title: '仅改标题', status: 'draft' }, schema);
  assert.equal(patched.id, 6);
  assert.equal(patched.title, '仅改标题');
  assert.equal(patched.status, 'draft');
  assert.equal(patched.email, snapshot.email, '未更新的生成字段值完全一致');
  assert.deepEqual(patched.employer, snapshot.employer, '未更新的嵌套对象保持同一值');
  assert.equal(patched.views, snapshot.views);
  // 原对象不被原地修改
  assert.equal(current.title, snapshot.title);
});

test('PATCH 无法改写 id 或塞入未知字段', () => {
  const current = { id: 8, title: 'a', email: 'e@x.com' };
  const patched = applyPartialUpdate(current, { id: 100, rogue: 1 }, schema);
  assert.equal(patched.id, 8);
  assert.ok(!('rogue' in patched));
});

test('knownFieldNames 给出顶层字段白名单', () => {
  assert.deepEqual([...knownFieldNames(schema)].sort(), ['email', 'employer', 'id', 'status', 'title', 'views']);
});
