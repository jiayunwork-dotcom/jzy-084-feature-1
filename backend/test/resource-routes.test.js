import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPathInResource, findRouteSpaceConflict } from '../src/services/resource-routes.js';
import {
  assertPathMethodUnique,
  assertRouteSpaceAvailable,
  findDuplicatePathMethod,
} from '../src/services/uniqueness.js';
import { ValidationError } from '../src/errors.js';

const articles = { id: 'r1', kind: 'resource', name: '文章集合', path: '/api/articles' };
const usersDetail = { id: 's1', kind: 'standard', name: '用户详情', method: 'GET', path: '/api/users/:id' };
const usersList = { id: 's2', kind: 'standard', name: '用户列表', method: 'GET', path: '/api/users' };

test('资源集合的路径空间 = 基础路径 + 恰好一个子段', () => {
  assert.ok(isPathInResource('/api/articles', '/api/articles'));
  assert.ok(isPathInResource('/api/articles', '/api/articles/123'));
  assert.ok(isPathInResource('/api/articles', '/api/articles/abc'));
  // 两个子段不属于该集合
  assert.ok(!isPathInResource('/api/articles', '/api/articles/123/comments'));
  // 平行路径不归属
  assert.ok(!isPathInResource('/api/articles', '/api/article/1'));
  assert.ok(!isPathInResource('/api/articles', '/api/posts'));
});

test('基础路径非法时安全返回 false', () => {
  assert.ok(!isPathInResource('/api/articles', 'articles'));
  assert.ok(!isPathInResource('/api/articles', '/api//articles'));
});

test('普通接口落在资源占用空间内被发现（精确与 /:id）', () => {
  assert.equal(
    findRouteSpaceConflict([articles], { kind: 'standard', path: '/api/articles' }),
    articles,
  );
  assert.equal(
    findRouteSpaceConflict([articles], { kind: 'standard', path: '/api/articles/9' }),
    articles,
  );
  assert.equal(
    findRouteSpaceConflict([articles], { kind: 'standard', path: '/api/articles/9/comments' }),
    null,
  );
});

test('候选资源覆盖已有普通接口时被发现', () => {
  assert.equal(
    findRouteSpaceConflict([usersList], { kind: 'resource', path: '/api/users' }),
    usersList,
  );
  assert.equal(
    findRouteSpaceConflict([usersDetail], { kind: 'resource', path: '/api/users' }),
    usersDetail,
  );
});

test('两个资源集合基础路径重叠被发现；不重叠放行', () => {
  const other = { id: 'r2', kind: 'resource', name: '另一集合', path: '/api/posts' };
  assert.equal(findRouteSpaceConflict([articles], { kind: 'resource', path: '/api/posts' }), null);
  assert.equal(findRouteSpaceConflict([other], { kind: 'resource', path: '/api/posts' }), other);
});

test('更新时排除自身 id，不会把自己当冲突', () => {
  assert.equal(
    findRouteSpaceConflict([articles], { kind: 'resource', path: '/api/articles' }, 'r1'),
    null,
  );
});

test('assertRouteSpaceAvailable 抛出带占用方说明的结构化错误', () => {
  assert.throws(
    () => assertRouteSpaceAvailable([articles], { kind: 'standard', path: '/api/articles/5' }),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.details[0].message, /文章集合/);
      return true;
    },
  );
});

test('资源形态不参与普通 路径+方法 唯一性判定（由路由空间检查接管）', () => {
  assert.equal(
    findDuplicatePathMethod(
      [articles],
      { kind: 'standard', method: 'GET', path: '/api/articles' },
    ),
    undefined,
  );
});

test('普通接口之间的旧唯一性规则行为不变', () => {
  assert.doesNotThrow(() =>
    assertPathMethodUnique(
      [usersList],
      { kind: 'standard', method: 'POST', path: '/api/users' },
    ));
  assert.throws(() =>
    assertPathMethodUnique(
      [usersList],
      { kind: 'standard', method: 'GET', path: '/api/users' },
    ));
});
