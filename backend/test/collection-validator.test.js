import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInterfaceInput } from '../src/services/validator.js';
import { ValidationError } from '../src/errors.js';

const noModels = new Set();
const inlineRecord = {
  type: 'object',
  fields: [{ name: 'title', type: 'string' }],
};

function collectionInput(overrides = {}) {
  const { collection, ...rest } = overrides;
  return {
    name: '集合接口',
    path: '/api/items',
    method: 'GET',
    kind: 'collection',
    ...rest,
    collection: {
      collectionKey: 'items',
      idField: 'id',
      seedCount: 5,
      record: inlineRecord,
      ...(collection || {}),
    },
  };
}

function expectValidationError(input, pattern) {
  assert.throws(
    () => validateInterfaceInput(input, noModels),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.match(JSON.stringify(err.details), pattern);
      return true;
    },
  );
}

test('集合接口：合法定义通过校验（列表与详情两种路径形态）', () => {
  assert.doesNotThrow(() => validateInterfaceInput(collectionInput(), noModels));
  assert.doesNotThrow(() =>
    validateInterfaceInput(
      collectionInput({ path: '/api/items/:id', method: 'DELETE' }),
      noModels,
    ),
  );
});

test('集合接口：缺少 collection 配置或 collectionKey 非法被拒绝', () => {
  expectValidationError(
    { name: 'x', path: '/a', method: 'GET', kind: 'collection' },
    /collection 配置/,
  );
  expectValidationError(collectionInput({ collection: { collectionKey: '' } }), /collectionKey/);
  expectValidationError(
    collectionInput({ collection: { collectionKey: '1bad key' } }),
    /collectionKey/,
  );
});

test('集合接口：idField 与 seedCount 非法被拒绝', () => {
  expectValidationError(collectionInput({ collection: { idField: '9x' } }), /标识字段/);
  expectValidationError(collectionInput({ collection: { seedCount: -1 } }), /种子记录数/);
  expectValidationError(collectionInput({ collection: { seedCount: 51 } }), /种子记录数/);
  expectValidationError(collectionInput({ collection: { seedCount: 2.5 } }), /种子记录数/);
});

test('集合接口：记录结构必须是 object 或 ref，ref 必须指向已存在模型', () => {
  expectValidationError(
    collectionInput({ collection: { record: { type: 'string' } } }),
    /记录结构/,
  );
  expectValidationError(
    collectionInput({ collection: { record: { type: 'ref', ref: 'ghost-model' } } }),
    /不存在的模型/,
  );
  assert.doesNotThrow(() =>
    validateInterfaceInput(
      collectionInput({ collection: { record: { type: 'ref', ref: 'm1' } } }),
      new Set(['m1']),
    ),
  );
});

test('集合接口：记录结构内的字段递归校验（枚举无候选值照样拦截）', () => {
  expectValidationError(
    collectionInput({
      collection: {
        record: { type: 'object', fields: [{ name: 'color', type: 'enum', values: [] }] },
      },
    }),
    /候选值/,
  );
});

test('集合接口：PUT/PATCH/DELETE 必须以 :参数 结尾', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    expectValidationError(collectionInput({ method }), new RegExp(`${method} 需要定位单条记录|以 :参数 结尾`));
  }
});

test('集合接口：POST 不允许带路径参数；路径参数必须在末尾且至多一个', () => {
  expectValidationError(
    collectionInput({ method: 'POST', path: '/api/items/:id' }),
    /不应以路径参数结尾/,
  );
  expectValidationError(
    collectionInput({ path: '/api/items/:id/sub' }),
    /最多包含一个路径参数/,
  );
  expectValidationError(
    collectionInput({ path: '/api/:org/items/:id' }),
    /最多包含一个路径参数/,
  );
});

test('接口形态 kind 非法被拒绝；stateless 行为不变（默认响应必填）', () => {
  expectValidationError(
    { name: 'x', path: '/a', method: 'GET', kind: 'weird', defaultResponse: { fields: [] } },
    /接口形态不合法/,
  );
  expectValidationError(
    { name: 'x', path: '/a', method: 'GET', kind: 'stateless' },
    /默认响应体字段定义缺失/,
  );
  // 集合接口不再强制默认响应
  assert.doesNotThrow(() => validateInterfaceInput(collectionInput(), noModels));
});
