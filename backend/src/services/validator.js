import { ValidationError } from '../errors.js';

/**
 * Definition-time validation. Everything invalid must be rejected when an
 * interface or model is saved — never at mock-request time.
 */

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const FIELD_TYPES = ['string', 'number', 'boolean', 'enum', 'array', 'object', 'ref'];
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const RESOURCE_KINDS = ['standard', 'resource'];

export const RESOURCE_DEFAULTS = {
  seedCount: 5,
  idField: 'id',
  pageSize: 10,
};
export const RESOURCE_LIMITS = {
  seedCountMin: 0,
  seedCountMax: 100,
  pageSizeMin: 1,
  pageSizeMax: 100,
};

/** Path must start with "/" and contain no "//" (and no whitespace). */
export function validateApiPath(path, details) {
  if (typeof path !== 'string' || path.length === 0) {
    details.push({ path: 'path', message: '请求路径不能为空' });
    return;
  }
  if (!path.startsWith('/')) {
    details.push({ path: 'path', message: `路径必须以斜杠开头：${path}` });
  }
  if (path.includes('//')) {
    details.push({ path: 'path', message: `路径不允许出现连续双斜杠：${path}` });
  }
  if (/\s/.test(path)) {
    details.push({ path: 'path', message: `路径不允许包含空白字符：${path}` });
  }
}

export function validateMethod(method, details) {
  const normalized = typeof method === 'string' ? method.toUpperCase() : method;
  if (!METHODS.includes(normalized)) {
    details.push({ path: 'method', message: `不支持的请求方法：${method}` });
  }
}

function validateField(field, ctx, details, prefix) {
  if (!field || typeof field !== 'object') {
    details.push({ path: prefix, message: '字段定义不合法' });
    return;
  }
  const here = prefix ? `${prefix}.${field.name || ''}` : field.name || '';
  if (!field.name || !IDENTIFIER_PATTERN.test(field.name)) {
    details.push({
      path: prefix,
      message: `字段名必须为合法标识符（字母/下划线开头），当前为：${JSON.stringify(field.name)}`,
    });
  }
  if (!FIELD_TYPES.includes(field.type)) {
    details.push({ path: here, message: `字段 ${field.name} 的类型不合法：${field.type}` });
    return;
  }

  if (field.type === 'enum') {
    if (!Array.isArray(field.values) || field.values.length === 0) {
      details.push({ path: here, message: `枚举字段 ${field.name} 至少需要一个候选值` });
    }
  } else if (field.type === 'array') {
    if (!field.items) {
      details.push({ path: here, message: `数组字段 ${field.name} 缺少元素类型定义` });
    } else {
      validateField(field.items, ctx, details, `${here}[]`);
    }
  } else if (field.type === 'object') {
    if (!Array.isArray(field.fields)) {
      details.push({ path: here, message: `对象字段 ${field.name} 缺少子字段列表` });
    } else {
      validateFieldList(field.fields, ctx, details, here);
    }
  } else if (field.type === 'ref') {
    if (!field.ref) {
      details.push({ path: here, message: `模型引用字段 ${field.name} 未指定引用的模型` });
    } else if (!ctx.modelIds.has(field.ref)) {
      details.push({
        path: here,
        message: `字段 ${field.name} 引用了不存在的模型：${field.ref}`,
      });
    }
  } else if (field.type === 'number') {
    if (Number.isFinite(field.min) && Number.isFinite(field.max) && field.min > field.max) {
      details.push({ path: here, message: `数字字段 ${field.name} 的最小值不能大于最大值` });
    }
  }
}

function validateFieldList(fields, ctx, details, prefix = 'fields') {
  if (!Array.isArray(fields)) {
    details.push({ path: prefix, message: '字段列表必须是数组' });
    return;
  }
  const seen = new Set();
  for (const field of fields) {
    if (field?.name) {
      if (seen.has(field.name)) {
        details.push({ path: `${prefix}.${field.name}`, message: `字段名重复：${field.name}` });
      }
      seen.add(field.name);
    }
    validateField(field, ctx, details, prefix);
  }
}

function validateScenario(scenario, ctx, details, index) {
  const prefix = `scenarios[${index}]`;
  if (!scenario.name) {
    details.push({ path: prefix, message: '场景名称不能为空' });
  }
  for (const [condIndex, condition] of (scenario.conditions || []).entries()) {
    const condPath = `${prefix}.conditions[${condIndex}]`;
    if (!['query', 'header', 'body'].includes(condition.location)) {
      details.push({ path: condPath, message: '匹配条件的来源必须是 query/header/body' });
    }
    if (!condition.field) {
      details.push({ path: condPath, message: '匹配条件缺少字段名' });
    }
    if (!['eq', 'ne', 'exists', 'not_exists', 'contains'].includes(condition.operator)) {
      details.push({ path: condPath, message: `不支持的匹配运算符：${condition.operator}` });
    }
  }
  if (!scenario.response || !Array.isArray(scenario.response.fields)) {
    details.push({ path: `${prefix}.response`, message: '场景缺少响应体字段定义' });
  } else {
    validateFieldList(scenario.response.fields, ctx, details, `${prefix}.response.fields`);
  }
}

function failIfAny(details) {
  if (details.length > 0) {
    throw new ValidationError('定义校验失败', details);
  }
}

export function validateModelInput(input, modelIds) {
  const details = [];
  if (!input.name || !input.name.trim()) {
    details.push({ path: 'name', message: '模型名称不能为空' });
  }
  const ctx = { modelIds };
  validateFieldList(input.fields, ctx, details, 'fields');
  failIfAny(details);
}

export function validateInterfaceInput(input, modelIds) {
  const details = [];
  validateApiPath(input.path, details);
  validateMethod(input.method, details);
  if (!input.name || !input.name.trim()) {
    details.push({ path: 'name', message: '接口名称不能为空' });
  }
  const kind = input.kind || 'standard';
  if (!RESOURCE_KINDS.includes(kind)) {
    details.push({ path: 'kind', message: `接口形态不合法：${input.kind}` });
  }
  const ctx = { modelIds };

  if (kind === 'resource') {
    validateResourceConfig(input, ctx, details);
  } else {
    if (!input.defaultResponse || !Array.isArray(input.defaultResponse.fields)) {
      details.push({ path: 'defaultResponse.fields', message: '默认响应体字段定义缺失' });
    } else {
      validateFieldList(input.defaultResponse.fields, ctx, details, 'defaultResponse.fields');
    }
    for (const [index, scenario] of (input.scenarios || []).entries()) {
      validateScenario(scenario, ctx, details, index);
    }
  }
  failIfAny(details);
}

/**
 * Resource-collection config: { fields, seedCount?, idField?, pageSize? }.
 * The record shape is a plain field tree (public-model refs allowed) and is
 * validated by the exact same rules as any other field list — including
 * dangling refs; model-vs-model cycles stay rejected on model save.
 */
export function validateResourceInput(input, modelIds) {
  const details = [];
  validateApiPath(input.path, details);
  validateMethod(input.method, details);
  if (!input.name || !input.name.trim()) {
    details.push({ path: 'name', message: '接口名称不能为空' });
  }
  validateResourceConfig(input, { modelIds }, details);
  failIfAny(details);
}

function validateResourceConfig(input, ctx, details) {
  const config = input.resourceConfig || {};
  if (!Array.isArray(config.fields)) {
    details.push({ path: 'resourceConfig.fields', message: '资源集合缺少记录字段结构' });
  } else {
    validateFieldList(config.fields, ctx, details, 'resourceConfig.fields');
  }

  // A resource collection occupies a static base path (item routes are
  // derived as base/:id); :param segments are not allowed here.
  if (typeof input.path === 'string' && input.path.startsWith('/') && !input.path.includes('//')) {
    if (input.path === '/') {
      details.push({
        path: 'path',
        message: '资源集合基础路径不能是根路径 /（将接管所有路径）',
      });
    }
    if (input.path.includes(':')) {
      details.push({
        path: 'path',
        message: `资源集合路径必须是静态基础路径（不带路径参数），当前为：${input.path}`,
      });
    }
    if (input.path.endsWith('/') && input.path !== '/') {
      details.push({ path: 'path', message: `资源集合路径不允许以斜杠结尾：${input.path}` });
    }
  }

  if (config.seedCount !== undefined) {
    if (!Number.isInteger(config.seedCount)
      || config.seedCount < RESOURCE_LIMITS.seedCountMin
      || config.seedCount > RESOURCE_LIMITS.seedCountMax) {
      details.push({
        path: 'resourceConfig.seedCount',
        message: `初始记录数必须是 ${RESOURCE_LIMITS.seedCountMin}~${RESOURCE_LIMITS.seedCountMax} 的整数`,
      });
    }
  }
  if (config.pageSize !== undefined) {
    if (!Number.isInteger(config.pageSize)
      || config.pageSize < RESOURCE_LIMITS.pageSizeMin
      || config.pageSize > RESOURCE_LIMITS.pageSizeMax) {
      details.push({
        path: 'resourceConfig.pageSize',
        message: `每页条数必须是 ${RESOURCE_LIMITS.pageSizeMin}~${RESOURCE_LIMITS.pageSizeMax} 的整数`,
      });
    }
  }
  if (config.idField !== undefined) {
    if (!config.idField || !IDENTIFIER_PATTERN.test(config.idField)) {
      details.push({
        path: 'resourceConfig.idField',
        message: `标识字段名必须为合法标识符，当前为：${JSON.stringify(config.idField)}`,
      });
    }
  }

  // Scenarios stay legal on resource collections; they take precedence over
  // collection read/write semantics when they match.
  for (const [index, scenario] of (input.scenarios || []).entries()) {
    validateScenario(scenario, ctx, details, index);
  }
}
