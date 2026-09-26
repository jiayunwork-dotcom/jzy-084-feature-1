import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateInterfaceInput,
  validateModelInput,
  validateApiPath,
} from '../src/services/validator.js';
import { ValidationError } from '../src/errors.js';

function expectValidation(fn, messageIncludes) {
  assert.throws(
    fn,
    (err) => {
      assert.ok(err instanceof ValidationError);
      if (messageIncludes) {
        const text = JSON.stringify(err.details);
        assert.ok(
          text.includes(messageIncludes),
          `错误信息应包含「${messageIncludes}」，实际：${text}`,
        );
      }
      return true;
    },
  );
}

test('路径必须以斜杠开头', () => {
  const details = [];
  validateApiPath('api/users', details);
  assert.equal(details.length, 1);
  assert.match(details[0].message, /斜杠/);
});

test('路径不允许连续双斜杠', () => {
  const details = [];
  validateApiPath('/api//users', details);
  assert.equal(details.length, 1);
  assert.match(details[0].message, /双斜杠/);
});

test('合法路径通过校验', () => {
  const details = [];
  validateApiPath('/api/users/:id', details);
  assert.deepEqual(details, []);
});

test('非法 HTTP 方法被拒绝', () => {
  expectValidation(() =>
    validateInterfaceInput(
      {
        name: 'x', path: '/x', method: 'WAT',
        defaultResponse: { fields: [] },
      },
      new Set(),
    ));
});

test('路径加方法的重复组合在服务层拦截（通过 validator 不负责，此处锁定路径格式错误结构）', () => {
  expectValidation(() =>
    validateInterfaceInput(
      { name: '', path: 'bad-path', method: 'GET', defaultResponse: { fields: [] } },
      new Set(),
    ));
});

test('枚举字段没有候选值时保存即报错，而非拖到请求时', () => {
  expectValidation(
    () => validateModelInput({ name: 'M', fields: [{ name: 'color', type: 'enum' }] }, new Set()),
    '候选值',
  );
});

test('引用不存在的模型在保存时报错', () => {
  expectValidation(
    () =>
      validateModelInput(
        { name: 'M', fields: [{ name: 'owner', type: 'ref', ref: 'ghost-id' }] },
        new Set(),
      ),
    '不存在的模型',
  );
});

test('数组缺少元素类型、对象缺少子字段均报错', () => {
  expectValidation(() =>
    validateModelInput({ name: 'M', fields: [{ name: 'list', type: 'array' }] }, new Set()));
  expectValidation(() =>
    validateModelInput({ name: 'M2', fields: [{ name: 'bag', type: 'object' }] }, new Set()));
});

test('数字字段 min 大于 max 报错', () => {
  expectValidation(() =>
    validateModelInput(
      { name: 'M', fields: [{ name: 'n', type: 'number', min: 10, max: 1 }] },
      new Set(),
    ));
});

test('场景缺少匹配字段名或运算符非法时报错', () => {
  const base = {
    name: 'api',
    path: '/api/x',
    method: 'GET',
    defaultResponse: { fields: [] },
    scenarios: [
      { name: 's1', conditions: [{ location: 'query', field: '', operator: 'eq', value: '1' }], response: { fields: [] } },
    ],
  };
  expectValidation(() => validateInterfaceInput(base, new Set()));
});

test('合法定义通过校验', () => {
  const modelIds = new Set(['m1']);
  validateModelInput(
    {
      name: 'User',
      fields: [
        { name: 'id', type: 'number', min: 1, max: 100 },
        { name: 'email', type: 'string' },
        { name: 'role', type: 'enum', values: ['admin', 'user'] },
        { name: 'address', type: 'ref', ref: 'm1' },
        { name: 'tags', type: 'array', items: { name: 'tag', type: 'string' } },
      ],
    },
    modelIds,
  );
});
