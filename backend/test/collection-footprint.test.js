import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interfacePathCollidesWithCollection,
  findInterfaceCollectionConflict,
  findCollectionInterfaceConflict,
  findCollectionPathConflict,
} from '../src/services/collection-footprint.js';

const articles = { id: 'c1', name: '文章', basePath: '/api/articles' };

test('接口与集合：根路径冲突', () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(
      interfacePathCollidesWithCollection('/api/articles', '/api/articles'),
      `${method} 根路径都应判冲突（集合优先返回 405 不能遮蔽接口）`,
    );
  }
});

test('接口与集合：:id 模板与条目路径冲突', () => {
  assert.ok(interfacePathCollidesWithCollection('/api/articles/:id', '/api/articles'));
});

test('接口与集合：看起来像条目路径的静态路径也冲突', () => {
  assert.ok(interfacePathCollidesWithCollection('/api/articles/1', '/api/articles'));
});

test('接口与集合：静态参数模板命中集合根（/api/:res 命中 /api/articles）也冲突', () => {
  assert.ok(interfacePathCollidesWithCollection('/api/:res', '/api/articles'));
});

test('接口与集合：无关路径、更深子路径不冲突', () => {
  assert.ok(!interfacePathCollidesWithCollection('/api/users', '/api/articles'));
  assert.ok(!interfacePathCollidesWithCollection('/api/articles/:id/comments', '/api/articles'));
  assert.ok(!interfacePathCollidesWithCollection('/api/articlesx', '/api/articles'));
});

test('findInterfaceCollectionConflict 返回冲突的接口对象', () => {
  const interfaces = [
    { id: 'i1', name: '用户', path: '/api/users', method: 'GET' },
    { id: 'i2', name: '文章详情', path: '/api/articles/:id', method: 'GET' },
  ];
  assert.equal(findInterfaceCollectionConflict(interfaces, articles).id, 'i2');
  assert.equal(findInterfaceCollectionConflict(
    [{ id: 'i1', name: '用户', path: '/api/users', method: 'GET' }],
    articles,
  ), null);
});

test('反向：保存接口时检测到集合冲突', () => {
  const clash = findCollectionInterfaceConflict([articles], {
    path: '/api/articles/9', method: 'DELETE',
  });
  assert.equal(clash.id, 'c1');
  assert.equal(findCollectionInterfaceConflict([articles], {
    path: '/api/posts', method: 'GET',
  }), null);
});

test('集合之间：同路径与嵌套路径冲突', () => {
  const collections = [
    { id: 'a', name: 'A', basePath: '/api/articles' },
    { id: 'b', name: 'B', basePath: '/api/posts' },
  ];
  assert.equal(findCollectionPathConflict(collections, '/api/articles').id, 'a');
  assert.equal(findCollectionPathConflict(collections, '/api/articles/drafts').id, 'a');
  assert.equal(findCollectionPathConflict(collections, '/api').id, 'a');
  assert.equal(findCollectionPathConflict(collections, '/api/articles', 'a'), null, '更新时排除自身');
  assert.equal(findCollectionPathConflict(collections, '/api/tags'), null);
});
