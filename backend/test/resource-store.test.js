import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecordFromSchema,
  extractEqualFilters,
  filterRecords,
  parsePagination,
  paginateRecords,
  coerceIdForField,
} from '../src/mock/resource-store.js';

const fields = [
  { name: 'id', type: 'number' },
  { name: 'userName', type: 'string' },
  { name: 'email', type: 'string' },
  { name: 'category', type: 'enum', values: ['tech', 'life'] },
  { name: 'viewCount', type: 'number', min: 0, max: 10 },
  { name: 'tags', type: 'array', items: { name: 'tag', type: 'string' } },
];

test('按结构生成：字段名推测、枚举范围、嵌套数组都走同一套生成器', () => {
  const record = buildRecordFromSchema(fields, new Map(), {}, { id: 1, idField: 'id' });
  assert.equal(record.id, 1);
  assert.equal(typeof record.userName, 'string');
  assert.match(record.email, /@/);
  assert.ok(['tech', 'life'].includes(record.category));
  assert.ok(record.viewCount >= 0 && record.viewCount <= 10);
  assert.ok(Array.isArray(record.tags));
});

test('请求体提供的顶层字段真正并入，未提供的字段由生成器补齐', () => {
  const record = buildRecordFromSchema(
    fields,
    new Map(),
    { userName: '张三', category: 'tech' },
    { id: 7, idField: 'id' },
  );
  assert.equal(record.userName, '张三');
  assert.equal(record.category, 'tech');
  assert.equal(record.id, 7);
  // 未提供的字段被生成补齐
  assert.match(record.email, /@/);
  assert.ok(Array.isArray(record.tags));
});

test('请求体里自带的 id 无法覆盖平台分配的稳定标识', () => {
  const record = buildRecordFromSchema(
    fields,
    new Map(),
    { id: 99999, userName: '甲' },
    { id: 3, idField: 'id' },
  );
  assert.equal(record.id, 3);
});

test('请求体里结构之外的字段被忽略', () => {
  const record = buildRecordFromSchema(
    fields,
    new Map(),
    { hacker: true, extra: 'nope' },
    { id: 1, idField: 'id' },
  );
  assert.equal('hacker' in record, false);
  assert.equal('extra' in record, false);
});

test('字符串型 id 字段：标识按字符串形态落盘', () => {
  const strFields = [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }];
  assert.equal(coerceIdForField({ type: 'string' }, 42), '42');
  const record = buildRecordFromSchema(strFields, new Map(), {}, { id: 42, idField: 'id' });
  assert.equal(record.id, '42');
  assert.equal(typeof record.id, 'string');
});

test('没有声明 id 字段时平台仍注入稳定标识', () => {
  const noIdFields = [{ name: 'title', type: 'string' }];
  const record = buildRecordFromSchema(noIdFields, new Map(), {}, { id: 5, idField: 'id' });
  assert.equal(record.id, 5);
  assert.equal(typeof record.title, 'string');
});

test('过滤：仅按顶层原始字段精确匹配，对象/数组字段不参与', () => {
  const records = [
    { id: 1, category: 'tech', tags: ['a'] },
    { id: 2, category: 'life', tags: ['b'] },
    { id: 3, category: 'tech', tags: ['c'] },
  ];
  assert.deepEqual(filterRecords(records, { category: 'tech' }).map((r) => r.id), [1, 3]);
  assert.deepEqual(filterRecords(records, { category: 'tech', id: 2 }).map((r) => r.id), []);
  assert.deepEqual(filterRecords(records, { tags: 'a' }).map((r) => r.id), []);
});

test('extractEqualFilters 剔除分页保留键与空值', () => {
  const equal = extractEqualFilters({
    page: '2',
    pageSize: '5',
    size: '10',
    category: 'tech',
    q: '',
    author: '甲',
  });
  assert.deepEqual(equal, { category: 'tech', author: '甲' });
});

test('翻页参数解析：默认值、下限、上限 100', () => {
  const defaults = 10;
  assert.deepEqual(parsePagination({}, defaults), { page: 1, pageSize: 10, offset: 0 });
  assert.deepEqual(parsePagination({ page: '3', pageSize: '20' }, defaults), {
    page: 3,
    pageSize: 20,
    offset: 40,
  });
  assert.equal(parsePagination({ page: '-1' }, defaults).page, 1);
  assert.equal(parsePagination({ pageSize: '999' }, defaults).pageSize, 100);
  assert.equal(parsePagination({ pageSize: 'abc' }, defaults).pageSize, 10);
});

test('分页切片附带正确的 total/totalPages', () => {
  const records = Array.from({ length: 23 }, (_, i) => ({ id: i + 1 }));
  const first = paginateRecords(records, parsePagination({ page: '1', pageSize: '10' }, 10));
  assert.equal(first.items.length, 10);
  assert.equal(first.pagination.total, 23);
  assert.equal(first.pagination.totalPages, 3);
  const last = paginateRecords(records, parsePagination({ page: '3', pageSize: '10' }, 10));
  assert.deepEqual(last.items.map((r) => r.id), [21, 22, 23]);
});
