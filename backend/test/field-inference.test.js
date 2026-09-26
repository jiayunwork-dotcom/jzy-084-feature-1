import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferStringCategory } from '../src/mock/field-inference.js';

test('字段名语义推测：邮箱类字段识别为 email', () => {
  for (const name of ['email', 'userEmail', 'user_email', 'contactEmail', 'E-mail', 'emailAddress']) {
    assert.equal(inferStringCategory(name), 'email', `${name} 应识别为 email`);
  }
});

test('字段名语义推测：电话类字段识别为 phone', () => {
  for (const name of ['phone', 'mobilePhone', 'mobile', 'tel', 'telephone', 'contact_phone']) {
    assert.equal(inferStringCategory(name), 'phone', `${name} 应识别为 phone`);
  }
});

test('字段名语义推测：人名类字段识别为 name', () => {
  for (const name of ['userName', 'name', 'fullName', 'nick_name', 'contactPerson']) {
    assert.equal(inferStringCategory(name), 'name', `${name} 应识别为 name`);
  }
});

test('字段名语义推测：地址/网址/头像/图片', () => {
  assert.equal(inferStringCategory('address'), 'address');
  assert.equal(inferStringCategory('homeAddress'), 'address');
  assert.equal(inferStringCategory('url'), 'url');
  assert.equal(inferStringCategory('homePage'), 'url');
  assert.equal(inferStringCategory('website'), 'url');
  assert.equal(inferStringCategory('avatar'), 'avatar');
  assert.equal(inferStringCategory('headImg'), 'avatar');
  assert.equal(inferStringCategory('imageUrl'), 'image');
});

test('字段名语义推测：公司名称与普通人名区分', () => {
  assert.equal(inferStringCategory('companyName'), 'companyName');
  assert.equal(inferStringCategory('corpName'), 'companyName');
  // 普通 name 字段仍是人名类别
  assert.equal(inferStringCategory('userName'), 'name');
});

test('字段名语义推测：识别不出语义时回退通用字符串', () => {
  assert.equal(inferStringCategory('foo'), 'fallback');
  assert.equal(inferStringCategory('xyzBaz'), 'fallback');
  assert.equal(inferStringCategory(''), 'fallback');
});

test('word-boundary 匹配避免误伤（filename 不是 name 类）', () => {
  assert.notEqual(inferStringCategory('filename'), 'name');
});
