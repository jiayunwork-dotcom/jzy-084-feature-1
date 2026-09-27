import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTrailingParam,
  parseListQuery,
  applyListQuery,
  buildRecordData,
  buildPatchedData,
  generateSeedSnapshot,
  topLevelFieldNames,
} from '../src/mock/collection-engine.js';

const recordNode = {
  type: 'object',
  fields: [
    { name: 'title', type: 'string' },
    { name: 'stock', type: 'number', min: 0, max: 100 },
    { name: 'onSale', type: 'boolean' },
  ],
};

test('extractTrailingParam：静态路径返回 null', () => {
  assert.equal(extractTrailingParam('/api/items', '/api/items'), null);
});

test('extractTrailingParam：尾参被捕获并解码', () => {
  assert.deepEqual(extractTrailingParam('/api/items/:id', '/api/items/42'), {
    param: 'id',
    value: '42',
  });
  assert.deepEqual(extractTrailingParam('/api/items/:id', '/api/items/a%20b'), {
    param: 'id',
    value: 'a b',
  });
});

test('extractTrailingParam：段数不一致或前缀不匹配返回 null', () => {
  assert.equal(extractTrailingParam('/api/items/:id', '/api/items/1/extra'), null);
  assert.equal(extractTrailingParam('/api/items/:id', '/api/other/1'), null);
});

test('parseListQuery：默认分页，保留字段过滤，忽略保留参数与未知字段', () => {
  const parsed = parseListQuery(
    { page: '2', pageSize: '10', stock: '7', unknown: 'x' },
    ['title', 'stock'],
  );
  assert.equal(parsed.page, 2);
  assert.equal(parsed.pageSize, 10);
  assert.deepEqual(parsed.filters, [{ field: 'stock', value: '7' }]);
});

test('parseListQuery：非法分页参数回退默认并夹紧上限', () => {
  const parsed = parseListQuery({ page: 'abc', pageSize: '9999' }, []);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 100);
  const empty = parseListQuery({}, []);
  assert.equal(empty.page, 1);
  assert.equal(empty.pageSize, 20);
});

test('applyListQuery：等值过滤 + 分页切片，顺序保持稳定', () => {
  const records = [
    { key: '1', seq: 1, data: { id: 1, stock: 5 } },
    { key: '2', seq: 2, data: { id: 2, stock: 7 } },
    { key: '3', seq: 3, data: { id: 3, stock: 7 } },
    { key: '4', seq: 4, data: { id: 4, stock: 9 } },
  ];
  const filtered = applyListQuery(records, { page: 1, pageSize: 20, filters: [{ field: 'stock', value: '7' }] });
  assert.equal(filtered.total, 2);
  assert.deepEqual(filtered.list.map((r) => r.id), [2, 3]);

  const paged = applyListQuery(records, { page: 2, pageSize: 1, filters: [{ field: 'stock', value: '7' }] });
  assert.equal(paged.total, 2);
  assert.deepEqual(paged.list.map((r) => r.id), [3]);

  // 未改动时两次取列表结果完全一致
  const again = applyListQuery(records, { page: 1, pageSize: 20, filters: [] });
  assert.deepEqual(again, applyListQuery(records, { page: 1, pageSize: 20, filters: [] }));
});

test('buildRecordData：生成补齐缺失字段，请求体覆盖，平台 id 强制生效', () => {
  const data = buildRecordData(recordNode, new Map(), { stock: 42, id: 999 }, 'id', 7);
  assert.equal(data.id, 7); // 平台分配优先于请求体
  assert.equal(data.stock, 42); // 请求体覆盖生成值
  assert.equal(typeof data.title, 'string'); // 未提供的字段被生成补齐
  assert.equal(typeof data.onSale, 'boolean');
});

test('buildPatchedData：只改给定字段，id 保持不变', () => {
  const existing = { id: 3, title: 'old', stock: 1 };
  const patched = buildPatchedData(existing, { stock: 9, id: 100 }, 'id');
  assert.deepEqual(patched, { id: 3, title: 'old', stock: 9 });
});

test('generateSeedSnapshot：数量、序号、键与 nextSeq 正确', () => {
  const snapshot = generateSeedSnapshot(
    { idField: 'id', seedCount: 3, record: recordNode },
    new Map(),
  );
  assert.equal(snapshot.records.length, 3);
  assert.deepEqual(snapshot.records.map((r) => r.seq), [1, 2, 3]);
  assert.deepEqual(snapshot.records.map((r) => r.key), ['1', '2', '3']);
  assert.deepEqual(snapshot.records.map((r) => r.data.id), [1, 2, 3]);
  assert.equal(snapshot.nextSeq, 4);
});

test('topLevelFieldNames：就地定义与模型引用都能解析字段名', () => {
  assert.deepEqual(topLevelFieldNames(recordNode, new Map()), ['title', 'stock', 'onSale']);
  const models = new Map([['m1', { id: 'm1', fields: [{ name: 'a' }, { name: 'b' }] }]]);
  assert.deepEqual(topLevelFieldNames({ type: 'ref', ref: 'm1' }, models), ['a', 'b']);
  assert.deepEqual(topLevelFieldNames({ type: 'ref', ref: 'ghost' }, models), []);
});
