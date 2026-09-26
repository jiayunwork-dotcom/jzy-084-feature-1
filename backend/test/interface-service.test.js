import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPathMethodUnique, findDuplicatePathMethod } from '../src/services/uniqueness.js';
import { ValidationError } from '../src/errors.js';

const existing = [
  { id: 'existing', name: '已有接口', path: '/api/users', method: 'GET' },
  { id: 'other', name: '其它接口', path: '/api/orders', method: 'POST' },
];

test('同项目内路径+方法重复时被拒绝', () => {
  assert.ok(
    findDuplicatePathMethod(existing, { path: '/api/users', method: 'GET' }),
  );
  assert.throws(
    () => assertPathMethodUnique(existing, { path: '/api/users', method: 'GET' }),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.match(JSON.stringify(err.details), /GET \/api\/users/);
      return true;
    },
  );
});

test('方法大小写归一后仍能识别重复', () => {
  assert.ok(
    findDuplicatePathMethod(existing, { path: '/api/users', method: 'get' }),
  );
});

test('同路径不同方法不重复', () => {
  assert.equal(
    findDuplicatePathMethod(existing, { path: '/api/users', method: 'POST' }),
    undefined,
  );
  assert.doesNotThrow(() =>
    assertPathMethodUnique(existing, { path: '/api/users', method: 'POST' }));
});

test('同方法不同路径不重复', () => {
  assert.equal(
    findDuplicatePathMethod(existing, { path: '/api/posts', method: 'GET' }),
    undefined,
  );
});

test('更新时排除自身 id，不会误报重复', () => {
  assert.equal(
    findDuplicatePathMethod(
      existing,
      { path: '/api/users', method: 'GET' },
      'existing',
    ),
    undefined,
  );
});

test('错误信息指出占用方接口名，便于前端定位', () => {
  try {
    assertPathMethodUnique(existing, { path: '/api/orders', method: 'POST' });
    assert.fail('应当抛错');
  } catch (err) {
    assert.ok(err instanceof ValidationError);
    assert.match(err.details[0].message, /其它接口/);
  }
});
