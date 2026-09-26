/** Factory + helpers for schema field nodes used by the form editor. */

let idCounter = 0;
export function uid(prefix = 'f') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function createField(type = 'string') {
  const base = { id: uid(), name: '', type };
  switch (type) {
    case 'number':
      return { ...base, min: 0, max: 100, float: false };
    case 'enum':
      return { ...base, values: [] };
    case 'array':
      return { ...base, items: createField('string') };
    case 'object':
      return { ...base, fields: [] };
    case 'ref':
      return { ...base, ref: '' };
    default:
      return base;
  }
}

export const FIELD_TYPES = [
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'enum', label: '枚举' },
  { value: 'array', label: '数组' },
  { value: 'object', label: '嵌套对象' },
  { value: 'ref', label: '公共模型引用' },
];

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function createEmptyInterface() {
  return {
    name: '',
    path: '',
    method: 'GET',
    defaultResponse: { fields: [createField('string')] },
    scenarios: [],
  };
}

export function createEmptyScenario() {
  return {
    id: uid('sc'),
    name: '',
    statusCode: 200,
    conditions: [{ id: uid('c'), location: 'query', field: '', operator: 'eq', value: '' }],
    response: { fields: [createField('string')] },
  };
}

/** Remove client-only scratch state before sending definitions to the API. */
export function toPayload(definition) {
  return JSON.parse(JSON.stringify(definition));
}
