import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCycles, findNamedCycles, collectRefs } from '../src/services/cycle-detector.js';

function model(id, name, fieldRefs) {
  return {
    id,
    name,
    fields: fieldRefs.map((ref) => ({ name: `${ref}Field`, type: 'ref', ref })),
  };
}

test('无环图不报告任何环', () => {
  const models = new Map([
    ['a', model('a', 'A', ['b'])],
    ['b', model('b', 'B', ['c'])],
    ['c', model('c', 'C', [])],
  ]);
  assert.deepEqual(findCycles(models), []);
});

test('直接互引用被检测：A -> B -> A', () => {
  const models = new Map([
    ['a', model('a', 'A', ['b'])],
    ['b', model('b', 'B', ['a'])],
  ]);
  const cycles = findNamedCycles(models);
  assert.equal(cycles.length, 1);
  const names = cycles[0].names;
  assert.equal(names[0], names[names.length - 1], '环路径应首尾相接');
  assert.ok(names.includes('A') && names.includes('B'));
});

test('自引用被检测：A -> A', () => {
  const models = new Map([['a', model('a', 'A', ['a'])]]);
  const cycles = findNamedCycles(models);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].names, ['A']);
});

test('经过更长链路成环也被检测：A -> B -> C -> A', () => {
  const models = new Map([
    ['a', model('a', 'A', ['b'])],
    ['b', model('b', 'B', ['c'])],
    ['c', model('c', 'C', ['a'])],
    ['d', model('d', 'D', ['a'])], // 入边，不在环上
  ]);
  const cycles = findNamedCycles(models);
  assert.equal(cycles.length, 1);
  const names = cycles[0].names;
  assert.deepEqual([...new Set(names)].sort(), ['A', 'B', 'C']);
  assert.equal(names[0], names[names.length - 1]);
});

test('经由数组元素/嵌套对象的引用同样参与成环检测', () => {
  const models = new Map([
    ['a', {
      id: 'a', name: 'A', fields: [
        { name: 'items', type: 'array', items: { name: 'b', type: 'ref', ref: 'b' } },
      ],
    }],
    ['b', {
      id: 'b', name: 'B', fields: [
        { name: 'nested', type: 'object', fields: [{ name: 'a', type: 'ref', ref: 'a' }] },
      ],
    }],
  ]);
  assert.equal(findCycles(models).length, 1);
});

test('collectRefs 收集嵌套与数组中的全部引用', () => {
  const refs = collectRefs({
    type: 'object',
    fields: [
      { name: 'x', type: 'ref', ref: 'x' },
      { name: 'arr', type: 'array', items: { name: 'y', type: 'ref', ref: 'y' } },
      { name: 'obj', type: 'object', fields: [{ name: 'z', type: 'ref', ref: 'z' }] },
    ],
  });
  assert.deepEqual([...refs].sort(), ['x', 'y', 'z']);
});
