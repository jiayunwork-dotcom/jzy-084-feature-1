import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateNode } from '../src/mock/data-generator.js';

test('email 字段产出合法邮箱格式', () => {
  for (let i = 0; i < 50; i += 1) {
    const value = generateNode({ name: 'email', type: 'string' });
    assert.match(value, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, `${value} 不是合法邮箱`);
  }
});

test('phone 字段产出 11 位中国大陆手机号（1 开头）', () => {
  for (let i = 0; i < 50; i += 1) {
    const value = generateNode({ name: 'mobilePhone', type: 'string' });
    assert.match(value, /^1[3-9]\d{9}$/, `${value} 不是合法手机号`);
  }
});

test('url 字段产出合法链接', () => {
  for (let i = 0; i < 50; i += 1) {
    const value = generateNode({ name: 'website', type: 'string' });
    assert.match(value, /^https:\/\/.+\..+/, `${value} 不是合法链接`);
  }
});

test('avatar 字段产出图片链接', () => {
  const value = generateNode({ name: 'avatar', type: 'string' });
  assert.match(value, /^https?:\/\/.+/);
});

test('name 字段产出非空人名', () => {
  for (let i = 0; i < 20; i += 1) {
    const value = generateNode({ name: 'userName', type: 'string' });
    assert.equal(typeof value, 'string');
    assert.ok(value.length >= 2);
  }
});

test('companyName 字段产出公司名而不是人名', () => {
  for (let i = 0; i < 20; i += 1) {
    const value = generateNode({ name: 'companyName', type: 'string' });
    assert.match(value, /公司$/);
  }
});

test('address 字段产出含「号」的地址串', () => {
  const value = generateNode({ name: 'homeAddress', type: 'string' });
  assert.match(value, /号/);
});

test('无语义字段回退通用随机字符串', () => {
  const value = generateNode({ name: 'quux', type: 'string' });
  assert.match(value, /^mock_/);
});

test('number 字段落在声明范围内（整数）', () => {
  for (let i = 0; i < 100; i += 1) {
    const value = generateNode({ name: 'age', type: 'number', min: 18, max: 30 });
    assert.ok(Number.isInteger(value));
    assert.ok(value >= 18 && value <= 30);
  }
});

test('boolean 字段只产出 true/false', () => {
  const values = new Set();
  for (let i = 0; i < 20; i += 1) values.add(generateNode({ name: 'active', type: 'boolean' }));
  assert.ok([...values].every((v) => typeof v === 'boolean'));
});

test('enum 字段只从候选值中选取', () => {
  const candidates = ['red', 'green', 'blue'];
  for (let i = 0; i < 50; i += 1) {
    const value = generateNode({ name: 'color', type: 'enum', values: candidates });
    assert.ok(candidates.includes(value));
  }
});

test('array 字段生成 1-5 个递归元素', () => {
  for (let i = 0; i < 30; i += 1) {
    const value = generateNode({
      name: 'scores',
      type: 'array',
      items: { name: 'score', type: 'number', min: 0, max: 100 },
    });
    assert.ok(Array.isArray(value));
    assert.ok(value.length >= 1 && value.length <= 5);
    assert.ok(value.every((v) => v >= 0 && v <= 100));
  }
});

test('嵌套对象递归生成全部字段', () => {
  const value = generateNode({
    type: 'object',
    fields: [
      { name: 'id', type: 'number', min: 1, max: 1 },
      { name: 'profile', type: 'object', fields: [
        { name: 'email', type: 'string' },
        { name: 'verified', type: 'boolean' },
      ] },
    ],
  });
  assert.equal(value.id, 1);
  assert.match(value.profile.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  assert.equal(typeof value.profile.verified, 'boolean');
});

test('模型引用多层递归展开（模型引用模型）', () => {
  const models = new Map([
    ['address', { id: 'address', name: 'Address', fields: [
      { name: 'city', type: 'string' },
      { name: 'detail', type: 'string' },
    ] }],
    ['company', { id: 'company', name: 'Company', fields: [
      { name: 'companyName', type: 'string' },
      { name: 'address', type: 'ref', ref: 'address' },
    ] }],
    ['user', { id: 'user', name: 'User', fields: [
      { name: 'userName', type: 'string' },
      { name: 'email', type: 'string' },
      { name: 'employer', type: 'ref', ref: 'company' },
    ] }],
  ]);

  const value = generateNode({ type: 'ref', ref: 'user' }, models);
  assert.equal(typeof value.userName, 'string');
  assert.match(value.email, /@/);
  assert.equal(typeof value.employer.companyName, 'string');
  assert.equal(typeof value.employer.address.city, 'string');
  assert.equal(typeof value.employer.address.detail, 'string');
});

test('数组内模型引用同样递归展开', () => {
  const models = new Map([
    ['tag', { id: 'tag', name: 'Tag', fields: [
      { name: 'label', type: 'enum', values: ['a', 'b'] },
    ] }],
  ]);
  const value = generateNode(
    { type: 'array', items: { name: 'tag', type: 'ref', ref: 'tag' } },
    models,
  );
  assert.ok(value.every((item) => ['a', 'b'].includes(item.label)));
});
