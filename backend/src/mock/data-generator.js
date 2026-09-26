import { inferStringCategory } from './field-inference.js';

/**
 * Fake data generator.
 *
 * generateNode(node, models) turns a schema node into a plausible value:
 *  - string   value inferred from the field name (email/phone/...)
 *  - number   random integer (or float) within [min, max]
 *  - boolean  random true/false
 *  - enum     one of the declared candidate values
 *  - array    1..5 items generated recursively from the item node
 *  - object   an object whose properties are generated from its fields
 *  - ref      the referenced public model, recursively expanded
 *
 * A ref-resolution depth guard protects generation even if malformed cyclic
 * data ever reaches this module; cycles are normally rejected at save time.
 */

const MAX_REF_DEPTH = 32;

const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '郑'];
const GIVEN_NAMES = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平', '子轩', '梓涵', '雨桐', '浩然', '欣怡'];
const DOMAINS = ['example.com', 'mail.com', 'demo.io', 'team.dev', 'corp.cn', 'test.org'];
const FIRST_WORDS = ['bright', 'blue', 'silent', 'rapid', 'golden', 'wild', 'quiet', 'lucky'];
const SECOND_WORDS = ['river', 'cloud', 'forest', 'stone', 'meadow', 'harbor', 'summit', 'valley'];
const PROVINCES = ['北京市', '上海市', '广东省广州市', '浙江省杭州市', '江苏省南京市', '四川省成都市', '湖北省武汉市', '陕西省西安市'];
const ROADS = ['中山路', '解放大道', '建设街', '人民路', '朝阳路', '滨江大道', '学府街', '科技园路'];
const COMPANY_PREFIXES = ['智云', '星辰', '蓝海', '恒远', '启明', '鸿翼', '拓维', '华讯', '灵动', '峰尚'];
const COMPANY_SUFFIXES = ['科技有限公司', '信息技术有限公司', '网络科技有限公司', '数据服务有限公司', '智能装备股份有限公司'];
const RANDOM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomString(len = 8) {
  let out = '';
  for (let i = 0; i < len; i += 1) out += RANDOM_CHARS[randomInt(0, RANDOM_CHARS.length - 1)];
  return out;
}

const generators = {
  string(node) {
    const category = inferStringCategory(node.name);
    switch (category) {
      case 'name':
        return pick(SURNAMES) + pick(GIVEN_NAMES);
      case 'companyName':
        return pick(COMPANY_PREFIXES) + pick(COMPANY_SUFFIXES);
      case 'email': {
        const local = `${pick(FIRST_WORDS)}.${randomString(4)}`.toLowerCase();
        return `${local}@${pick(DOMAINS)}`;
      }
      case 'phone':
        return `1${pick([3, 5, 7, 8, 9])}${randomString(9).replace(/\D/g, '0')}`.slice(0, 11);
      case 'address':
        return `${pick(PROVINCES)}${pick(ROADS)}${randomInt(1, 999)}号${randomInt(1, 30)}栋${randomInt(101, 2503)}室`;
      case 'url':
        return `https://${pick(FIRST_WORDS)}-${pick(SECOND_WORDS)}.${pick(DOMAINS)}`;
      case 'avatar':
        return `https://i.pravatar.cc/128?img=${randomInt(1, 70)}`;
      case 'image':
        return `https://picsum.photos/seed/${randomString(6)}/400/300`;
      default:
        return `mock_${randomString(8)}`;
    }
  },

  number(node) {
    const min = Number.isFinite(node.min) ? node.min : 0;
    const max = Number.isFinite(node.max) ? Math.max(node.max, min) : min + 100;
    if (node.float) {
      const value = Math.random() * (max - min) + min;
      return Number(value.toFixed(2));
    }
    return randomInt(Math.ceil(min), Math.floor(max));
  },

  boolean() {
    return Math.random() < 0.5;
  },

  enum(node) {
    return pick(node.values || []);
  },

  array(node, models, depth) {
    const length = randomInt(1, 5);
    const items = [];
    for (let i = 0; i < length; i += 1) {
      items.push(generateNode(node.items, models, depth + 1));
    }
    return items;
  },

  object(node, models, depth) {
    const result = {};
    for (const field of node.fields || []) {
      result[field.name] = generateNode(field, models, depth);
    }
    return result;
  },

  ref(node, models, depth) {
    const model = models.get(node.ref);
    if (!model || depth > MAX_REF_DEPTH) return null;
    return generators.object({ type: 'object', fields: model.fields }, models, depth + 1);
  },
};

export function generateNode(node, models = new Map(), depth = 0) {
  const generator = generators[node?.type];
  if (!generator) return null;
  return generator(node, models, depth);
}
