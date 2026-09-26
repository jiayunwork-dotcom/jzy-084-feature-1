import { generateNode } from './data-generator.js';

/**
 * Helpers bridging a resource collection's record schema and the existing
 * field-tree based fake data generator. No second generator is introduced —
 * seeding and field completion both go through generateNode().
 */

/** Normalize a stored record schema ({ source, fields? , modelId? }) to fields. */
export function schemaToFields(recordSchema) {
  if (!recordSchema || recordSchema.source === 'inline') {
    return recordSchema?.fields || [];
  }
  // model reference: expansion happens through the ref node at generation time
  return [];
}

/**
 * Build the schema node generateNode() consumes for a whole record.
 * Inline schemas become an object node; model-backed schemas become a ref.
 */
export function buildRecordNode(recordSchema) {
  if (recordSchema?.source === 'model') {
    return { type: 'ref', ref: recordSchema.modelId };
  }
  return { type: 'object', fields: recordSchema?.fields || [] };
}

/** Top-level record field names known to the schema (used for whitelist ops). */
export function knownFieldNames(recordSchema) {
  if (recordSchema?.source !== 'inline') return null; // unknown without model map
  return new Set((recordSchema.fields || []).map((f) => f.name));
}

/**
 * Generate one record: data from the single existing generator, with the
 * platform-owned stable identifier stamped in afterwards. The identifier
 * always lives at the top-level `id` key; any schema field named `id` is
 * overridden so stored ids can never diverge from the allocated one.
 */
export function generateRecord(recordSchema, models, id) {
  const data = generateNode(buildRecordNode(recordSchema), models) || {};
  return { ...data, id };
}

/** Generate the fixed initial seed batch; ids 1..count, stable thereafter. */
export function generateSeedRecords(recordSchema, seedCount, models) {
  const records = [];
  for (let i = 1; i <= seedCount; i += 1) {
    records.push({ id: i, data: generateRecord(recordSchema, models, i) });
  }
  return records;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merge a request body into a freshly generated record on create.
 * Only top-level schema fields are accepted; unknown keys are ignored.
 * Nested fields are not deep-merged.
 */
export function buildRecordFromBody(recordSchema, models, id, body) {
  const record = generateRecord(recordSchema, models, id);
  if (!isPlainObject(body)) return record;
  const allowed = knownFieldNames(recordSchema);
  for (const [key, value] of Object.entries(body)) {
    if (key === 'id') continue; // the platform owns the identifier
    if (allowed && !allowed.has(key)) continue;
    record[key] = value;
  }
  record.id = id;
  return record;
}

/**
 * PUT semantics: full replacement of schema-declared fields. Fields present
 * in the body take the given value; fields absent become null. The stable id
 * never changes and cannot be rewritten through the body.
 */
export function applyFullReplacement(current, body, recordSchema) {
  const allowed = knownFieldNames(recordSchema);
  const next = {};
  if (allowed) {
    for (const name of allowed) {
      next[name] = Object.prototype.hasOwnProperty.call(body || {}, name)
        ? body[name]
        : null;
    }
  } else if (isPlainObject(body)) {
    // model-backed schema: preserve current values, overlay body keys
    Object.assign(next, current);
    for (const [key, value] of Object.entries(body)) {
      if (key !== 'id') next[key] = value;
    }
  }
  next.id = current.id;
  return next;
}

/**
 * PATCH semantics: only the provided top-level fields change; every other
 * field (including generated-once values) stays byte-for-byte identical.
 */
export function applyPartialUpdate(current, body, recordSchema) {
  if (!isPlainObject(body)) return { ...current };
  const allowed = knownFieldNames(recordSchema);
  const next = { ...current };
  for (const [key, value] of Object.entries(body)) {
    if (key === 'id') continue;
    if (allowed && !allowed.has(key)) continue;
    next[key] = value;
  }
  next.id = current.id;
  return next;
}
