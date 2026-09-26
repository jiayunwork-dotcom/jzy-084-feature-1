import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInterfaceInput } from '../src/services/validator.js';
import { ValidationError } from '../src/errors.js';

function expectValidation(input, modelIds = new Set()) {
  assert.throws(
    () => validateInterfaceInput(input, modelIds),
    (err) => {
      assert.ok(err instanceof ValidationError);
      return true;
    },
  );
}

function expectValid(input, modelIds = new Set()) {
  assert.doesNotThrow(() => validateInterfaceInput(input, modelIds));
}

const baseResource = (overrides = {}) => ({
  name: '文章集合',
  path: '/api/articles',
  method: 'GET',
  kind: 'resource',
  resourceConfig: {
    fields: [
      { name: 'id', type: 'number' },
      { name: 'title', type: 'string' },
    ],
    seedCount: 5,
    idField: 'id',
    pageSize: 10,
  },
  scenarios: [],
  ...overrides,
});

test('合法资源集合定义通过校验', () => {
  expectValid(baseResource());
});

test('资源集合缺少记录字段结构被拒绝', () => {
  const input = baseResource({ resourceConfig: { seedCount: 3 } });
  expectValidation(input);
  try {
    validateInterfaceInput(input, new Set());
  } catch (err) {
    assert.match(JSON.stringify(err.details), /resourceConfig\.fields/);
  }
});

test('资源集合路径不允许带路径参数（条目路由由平台派生）', () => {
  const input = baseResource({ path: '/api/articles/:id' });
  expectValidation(input);
  try {
    validateInterfaceInput(input, new Set());
  } catch (err) {
    assert.match(JSON.stringify(err.details), /静态基础路径/);
  }
});

test('资源集合路径不允许以斜杠结尾', () => {
  const input = baseResource({ path: '/api/articles/' });
  expectValidation(input);
});

test('seedCount / pageSize 超范围被拒绝', () => {
  expectValidation(baseResource({ resourceConfig: { fields: [{ name: 'id', type: 'number' }], seedCount: -1 } }));
  expectValidation(baseResource({ resourceConfig: { fields: [{ name: 'id', type: 'number' }], seedCount: 101 } }));
  expectValidation(baseResource({ resourceConfig: { fields: [{ name: 'id', type: 'number' }], pageSize: 0 } }));
  expectValidation(baseResource({ resourceConfig: { fields: [{ name: 'id', type: 'number' }], pageSize: 500 } }));
});

test('idField 必须是合法标识符', () => {
  expectValidation(
    baseResource({ resourceConfig: { fields: [], idField: 'bad-id' } }),
  );
});

test('资源集合记录结构引用不存在的模型照样被拒绝', () => {
  const input = baseResource({
    resourceConfig: {
      fields: [{ name: 'author', type: 'ref', ref: 'ghost' }],
    },
  });
  expectValidation(input);
  try {
    validateInterfaceInput(input, new Set());
  } catch (err) {
    assert.match(JSON.stringify(err.details), /不存在的模型/);
  }
});

test('资源集合上的条件场景仍按原规则校验', () => {
  const input = baseResource({
    scenarios: [
      {
        name: '坏场景',
        conditions: [{ location: 'cookie', field: 'x', operator: 'eq', value: '1' }],
        response: { fields: [] },
      },
    ],
  });
  expectValidation(input);
});

test('资源集合记录字段为合法模型引用时通过（成环仍由模型保存拦截）', () => {
  expectValid(
    baseResource({
      resourceConfig: {
        fields: [
          { name: 'id', type: 'number' },
          { name: 'author', type: 'ref', ref: 'model-1' },
        ],
      },
    }),
    new Set(['model-1']),
  );
});

test('普通接口在新分支下行为不变：仍要求 defaultResponse.fields', () => {
  expectValidation({ name: 'x', path: '/x', method: 'GET', kind: 'standard' });
  expectValid({
    name: 'x',
    path: '/x',
    method: 'GET',
    defaultResponse: { fields: [{ name: 'ok', type: 'boolean' }] },
  });
});
