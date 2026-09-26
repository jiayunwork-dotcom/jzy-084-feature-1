import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectScenario, matchCondition } from '../src/mock/scenario-matcher.js';

function req({ query = {}, headers = {}, body = {}, headerMap }) {
  return {
    query,
    body,
    header: (name) => {
      const lower = String(name).toLowerCase();
      if (headerMap) return headerMap[lower];
      return headers[lower] ?? headers[name];
    },
  };
}

const scenarios = [
  {
    id: 's1',
    name: '带令牌的管理员',
    conditions: [
      { location: 'header', field: 'x-token', operator: 'eq', value: 'admin-token' },
    ],
  },
  {
    id: 's2',
    name: 'VIP 查询参数',
    conditions: [{ location: 'query', field: 'vip', operator: 'eq', value: 'true' }],
  },
  {
    id: 's3',
    name: 'body 中 type 为 beta',
    conditions: [{ location: 'body', field: 'type', operator: 'eq', value: 'beta' }],
  },
  {
    id: 's4',
    name: '无条件兜底场景',
    conditions: [],
  },
];

test('严格按声明顺序：同时命中多个条件时取第一个', () => {
  const request = req({
    query: { vip: 'true' },
    headerMap: { 'x-token': 'admin-token' },
    body: { type: 'beta' },
  });
  const hit = selectScenario(scenarios, request);
  assert.equal(hit.id, 's1');
});

test('第一个不命中时继续向后判定，命中第二套', () => {
  const request = req({
    query: { vip: 'true' },
    headerMap: { 'x-token': 'something-else' },
    body: { type: 'beta' },
  });
  assert.equal(selectScenario(scenarios, request).id, 's2');
});

test('仅命中第三套时取第三套', () => {
  const request = req({ headerMap: {}, body: { type: 'beta' } });
  assert.equal(selectScenario(scenarios, request).id, 's3');
});

test('都不命中时返回 null，由调用方走默认响应', () => {
  // s4 是空条件场景，因此这里用一组「全不满足」的非空场景
  const onlyConditional = scenarios.slice(0, 3);
  const request = req({ headerMap: {}, body: { type: 'ga' } });
  assert.equal(selectScenario(onlyConditional, request), null);
});

test('无条件场景总是命中（顺序决定它是否能走到）', () => {
  const request = req({});
  assert.equal(selectScenario(scenarios, request).id, 's4');
});

test('多条件之间是 AND：任一不满足则该场景不命中', () => {
  const scenario = {
    name: 'combo',
    conditions: [
      { location: 'query', field: 'a', operator: 'eq', value: '1' },
      { location: 'query', field: 'b', operator: 'eq', value: '2' },
    ],
  };
  assert.equal(selectScenario([scenario], req({ query: { a: '1', b: '2' } })), scenario);
  assert.equal(selectScenario([scenario], req({ query: { a: '1', b: '3' } })), null);
});

test('exists / contains / ne 运算符行为', () => {
  assert.equal(
    matchCondition({ location: 'header', field: 'authorization', operator: 'exists' },
      req({ headerMap: { authorization: 'Bearer x' } })),
    true,
  );
  assert.equal(
    matchCondition({ location: 'header', field: 'authorization', operator: 'exists' },
      req({ headerMap: {} })),
    false,
  );
  assert.equal(
    matchCondition({ location: 'query', field: 'q', operator: 'contains', value: 'abc' },
      req({ query: { q: 'xxabcyy' } })),
    true,
  );
  assert.equal(
    matchCondition({ location: 'query', field: 'debug', operator: 'ne', value: '1' },
      req({ query: { debug: '0' } })),
    true,
  );
});

test('请求头匹配大小写不敏感', () => {
  assert.equal(
    matchCondition({ location: 'header', field: 'X-Token', operator: 'eq', value: 't' },
      req({ headerMap: { 'x-token': 't' } })),
    true,
  );
});
