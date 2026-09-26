import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToRegExp } from '../src/mock/dispatcher.js';

test('路径模板参数段匹配任意单段，静态字符被转义', () => {
  const re = pathToRegExp('/api/users/:id');
  assert.ok(re.test('/api/users/123'));
  assert.ok(re.test('/api/users/abc'));
  assert.ok(!re.test('/api/users/123/posts'));
  assert.ok(!re.test('/api/user/123'));
});

test('多个参数段', () => {
  const re = pathToRegExp('/api/shops/:shopId/orders/:orderId');
  assert.ok(re.test('/api/shops/9/orders/42'));
  assert.ok(!re.test('/api/shops/9/orders'));
});
