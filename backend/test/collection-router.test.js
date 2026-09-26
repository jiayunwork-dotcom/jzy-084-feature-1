import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCollectionRoute, paginateRecords } from '../src/mock/collection-router.js';

const collection = { basePath: '/api/articles' };

test('集合根路径：GET/POST 为集合操作', () => {
  assert.deepEqual(matchCollectionRoute(collection, 'GET', '/api/articles'), { action: 'collection' });
  assert.deepEqual(matchCollectionRoute(collection, 'POST', '/api/articles'), { action: 'collection' });
});

test('集合根路径：PUT/PATCH/DELETE 返回 405 语义', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const match = matchCollectionRoute(collection, method, '/api/articles');
    assert.equal(match.unsupported, true, `${method} 应不支持`);
    assert.deepEqual(match.allowed, ['GET', 'POST']);
  }
});

test('单条路径：GET/PUT/PATCH/DELETE 为条目操作并解析 id', () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const match = matchCollectionRoute(collection, method, '/api/articles/42');
    assert.deepEqual(match, { action: 'item', id: '42' }, method);
  }
});

test('单条路径：POST 不支持', () => {
  const match = matchCollectionRoute(collection, 'POST', '/api/articles/42');
  assert.equal(match.unsupported, true);
});

test('更深层子路径不属于集合，返回 null 交回普通匹配', () => {
  assert.equal(matchCollectionRoute(collection, 'GET', '/api/articles/1/comments'), null);
  assert.equal(matchCollectionRoute(collection, 'GET', '/api/other'), null);
  assert.equal(matchCollectionRoute(collection, 'GET', '/api/articlesx'), null);
});

test('分页：默认第一页、pageSize 上限与越界页回退', () => {
  const records = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, data: { id: i + 1 } }));
  const page1 = paginateRecords(records, {});
  assert.equal(page1.items.length, 20);
  assert.deepEqual(page1.pagination, { page: 1, pageSize: 20, total: 25, totalPages: 2 });

  const page2 = paginateRecords(records, { page: '2', pageSize: '10' });
  assert.equal(page2.items.length, 10);
  assert.equal(page2.items[0].id, 11);

  const overflow = paginateRecords(records, { page: '99', pageSize: '10' });
  assert.equal(overflow.pagination.page, 3, '越界页回退到最后一页');
  assert.equal(overflow.items.length, 5);

  const capped = paginateRecords(records, { pageSize: '500' });
  assert.equal(capped.pagination.pageSize, 100, 'pageSize 上限 100');
});

test('过滤：按顶层标量字段做等值匹配，两次查询结果一致', () => {
  const records = [
    { id: 1, data: { id: 1, status: 'draft', views: 10 } },
    { id: 2, data: { id: 2, status: 'published', views: 20 } },
    { id: 3, data: { id: 3, status: 'draft', views: 30 } },
  ];
  const first = paginateRecords(records, { status: 'draft' });
  const second = paginateRecords(records, { status: 'draft' });
  assert.deepEqual(first, second, '集合未变时两次读取必须一致');
  assert.equal(first.pagination.total, 2);
  assert.deepEqual(first.items.map((i) => i.id), [1, 3]);

  const byNumber = paginateRecords(records, { views: '20' });
  assert.deepEqual(byNumber.items.map((i) => i.id), [2], '数字按字符串宽松等值');

  const none = paginateRecords(records, { status: 'archived' });
  assert.equal(none.pagination.total, 0);
  assert.deepEqual(none.items, []);
});

test('过滤忽略 page/pageSize 保留字与空值', () => {
  const records = [{ id: 1, data: { id: 1, page: 'x' } }];
  const result = paginateRecords(records, { page: '1', pageSize: '5', status: '' });
  assert.equal(result.pagination.total, 1, 'page 不应被当作过滤字段');
});
