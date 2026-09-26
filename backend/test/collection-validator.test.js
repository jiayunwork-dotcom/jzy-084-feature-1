import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCollectionInput } from '../src/services/validator.js';
import { ValidationError } from '../src/errors.js';

function expectValidation(input, modelIds, messageIncludes) {
  assert.throws(
    () => validateCollectionInput(input, modelIds),
    (err) => {
      assert.ok(err instanceof ValidationError);
      if (messageIncludes) {
        assert.ok(
          JSON.stringify(err.details).includes(messageIncludes),
          `错误信息应包含「${messageIncludes}」，实际：${JSON.stringify(err.details)}`,
        );
      }
      return true;
    },
  );
}

const valid = {
  name: '文章',
  basePath: '/api/articles',
  seedCount: 5,
  recordSchema: {
    source: 'inline',
    fields: [{ name: 'title', type: 'string' }],
  },
};

test('合法集合定义通过校验（就地结构）', () => {
  validateCollectionInput(valid, new Set());
});

test('合法集合定义通过校验（引用公共模型）', () => {
  validateCollectionInput(
    { ...valid, recordSchema: { source: 'model', modelId: 'm1' } },
    new Set(['m1']),
  );
});

test('路径规则沿用：斜杠开头、无连续双斜杠', () => {
  expectValidation({ ...valid, basePath: 'api/x' }, new Set(), '斜杠');
  expectValidation({ ...valid, basePath: '/api//x' }, new Set(), '双斜杠');
});

test('集合路径不允许参数段', () => {
  expectValidation({ ...valid, basePath: '/api/articles/:id' }, new Set(), '参数段');
});

test('集合路径不允许以斜杠结尾', () => {
  expectValidation({ ...valid, basePath: '/api/articles/' }, new Set(), '斜杠结尾');
});

test('种子条数必须是 0~200 的整数', () => {
  expectValidation({ ...valid, seedCount: -1 }, new Set(), '种子条数');
  expectValidation({ ...valid, seedCount: 201 }, new Set(), '种子条数');
  expectValidation({ ...valid, seedCount: 2.5 }, new Set(), '种子条数');
  // 0 合法（空集合，后续靠 POST 建数据）
  validateCollectionInput({ ...valid, seedCount: 0 }, new Set());
});

test('缺少记录结构 / 非法来源被拒绝', () => {
  expectValidation({ ...valid, recordSchema: null }, new Set(), '记录结构');
  expectValidation(
    { ...valid, recordSchema: { source: 'weird', fields: [] } },
    new Set(),
    'inline 或 model',
  );
});

test('引用模型为空或不存在被拒绝', () => {
  expectValidation(
    { ...valid, recordSchema: { source: 'model' } },
    new Set(),
    '未选择',
  );
  expectValidation(
    { ...valid, recordSchema: { source: 'model', modelId: 'ghost' } },
    new Set(['m1']),
    '不存在的模型',
  );
});

test('就地结构里的字段沿用同一套字段校验（枚举无候选值、非法引用）', () => {
  expectValidation(
    { ...valid, recordSchema: { source: 'inline', fields: [{ name: 'color', type: 'enum' }] } },
    new Set(),
    '候选值',
  );
  expectValidation(
    { ...valid, recordSchema: {
      source: 'inline',
      fields: [{ name: 'owner', type: 'ref', ref: 'ghost' }],
    } },
    new Set(),
    '不存在的模型',
  );
});

test('集合名称不能为空', () => {
  expectValidation({ ...valid, name: '  ' }, new Set(), '集合名称');
});
