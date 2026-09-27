import { generateNode } from './data-generator.js';
import * as collectionRepo from '../db/collection-repo.js';
import { getModelMap } from '../services/model-service.js';

/**
 * Stateful collection engine.
 *
 * Implements the read/write semantics of a resource-collection interface on
 * top of collection-repo persistence. Data generation for seeds and for
 * filling missing fields deliberately reuses the SAME data-generator as the
 * stateless path — no second fake-data generator exists.
 *
 * Method semantics (enforced at save time by the validator):
 *   GET    path without :param  -> list (pagination + equality filters)
 *   GET    path with :param     -> fetch one record
 *   POST   path without :param  -> create (platform assigns the id)
 *   PUT    path with :param     -> full replace (missing fields re-generated)
 *   PATCH  path with :param     -> partial update (missing fields preserved)
 *   DELETE path with :param     -> remove
 */

const RESERVED_QUERY_PARAMS = new Set(['page', 'pageSize']);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Extract the trailing `:param` capture from a matched collection path. */
export function extractTrailingParam(pathTemplate, pathname) {
  const templateSegs = String(pathTemplate).split('/').filter(Boolean);
  const pathSegs = String(pathname).split('/').filter(Boolean);
  if (templateSegs.length === 0 || templateSegs.length !== pathSegs.length) return null;
  const last = templateSegs[templateSegs.length - 1];
  if (!last.startsWith(':')) return null;
  for (let i = 0; i < templateSegs.length - 1; i += 1) {
    if (templateSegs[i] !== pathSegs[i]) return null;
  }
  const raw = pathSegs[pathSegs.length - 1];
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // keep the raw segment when it is not valid percent-encoding
  }
  return { param: last.slice(1), value };
}

/** Top-level field names of the record schema (refs resolved via models). */
export function topLevelFieldNames(recordNode, models) {
  if (recordNode?.type === 'object') {
    return (recordNode.fields || []).map((field) => field.name);
  }
  if (recordNode?.type === 'ref') {
    const model = models.get(recordNode.ref);
    return model ? (model.fields || []).map((field) => field.name) : [];
  }
  return [];
}

/**
 * Parse list query params: `page` / `pageSize` are reserved; every other
 * param that names a top-level record field becomes an equality filter.
 */
export function parseListQuery(query = {}, fieldNames = []) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const parsedSize = Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parsedSize));
  const known = new Set(fieldNames);
  const filters = Object.entries(query)
    .filter(
      ([name, value]) =>
        !RESERVED_QUERY_PARAMS.has(name) && known.has(name) && typeof value === 'string',
    )
    .map(([name, value]) => ({ field: name, value }));
  return { page, pageSize, filters };
}

/** Apply filters + pagination to stored records (order already stable). */
export function applyListQuery(records, { page, pageSize, filters }) {
  const filtered =
    filters.length === 0
      ? records
      : records.filter((record) =>
          filters.every(
            ({ field, value }) =>
              record.data[field] !== undefined &&
              record.data[field] !== null &&
              String(record.data[field]) === value,
          ),
        );
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return {
    list: filtered.slice(start, start + pageSize).map((record) => record.data),
    total,
    page,
    pageSize,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Build a stored record: generate every schema field with the shared
 * generator, overlay the request body, then force the platform-managed id.
 */
export function buildRecordData(recordNode, models, body, idField, idValue) {
  const generated = generateNode(recordNode, models);
  const base = isPlainObject(generated) ? generated : {};
  return { ...base, ...(body || {}), [idField]: idValue };
}

/** PATCH: only the provided fields change; everything else is preserved. */
export function buildPatchedData(existingData, body, idField) {
  return { ...existingData, ...(body || {}), [idField]: existingData[idField] };
}

/**
 * Generate the seed batch once; the snapshot is persisted and becomes the
 * collection's fixed initial content (and what reset restores later).
 */
export function generateSeedSnapshot(collection, models) {
  const idField = collection.idField || 'id';
  const count = collection.seedCount;
  const records = [];
  for (let seq = 1; seq <= count; seq += 1) {
    const data = buildRecordData(collection.record, models, {}, idField, seq);
    records.push({ seq, key: String(seq), data });
  }
  return { records, nextSeq: count + 1 };
}

function recordNotFound(idField, key) {
  return {
    status: 404,
    body: { error: { code: 'RECORD_NOT_FOUND', message: `记录不存在：${idField} = ${key}` } },
    matchedScenario: null,
  };
}

function invalidBody(message) {
  return {
    status: 400,
    body: { error: { code: 'INVALID_BODY', message } },
    matchedScenario: null,
  };
}

function ok(status, body) {
  return { status, body, matchedScenario: null };
}

/**
 * Handle one mock request against a collection interface.
 * `deps` is injectable so the engine can be tested without a database.
 */
export async function handleCollectionRequest(projectId, api, request, deps = {}) {
  const repo = deps.repo || collectionRepo;
  const loadModels = deps.getModels || getModelMap;
  const collection = api.collection;
  const key = collection.collectionKey;
  const idField = collection.idField || 'id';
  const models = await loadModels(projectId);

  // Seed lazily on first access; afterwards the state is fixed in the store.
  await repo.ensureSeeded(projectId, key, collection, () =>
    generateSeedSnapshot(collection, models),
  );

  const method = request.method;
  const trailing = extractTrailingParam(api.path, request.path);

  if (method === 'GET' && !trailing) {
    const records = await repo.listRecords(projectId, key);
    const listQuery = parseListQuery(
      request.query,
      topLevelFieldNames(collection.record, models),
    );
    return ok(200, applyListQuery(records, listQuery));
  }

  if (method === 'GET' && trailing) {
    const record = await repo.getRecord(projectId, key, trailing.value);
    if (!record) return recordNotFound(idField, trailing.value);
    return ok(200, record.data);
  }

  if (method === 'POST') {
    if (trailing) return invalidBody('新建记录应指向集合路径（不以路径参数结尾）');
    if (request.body !== undefined && request.body !== null && !isPlainObject(request.body)) {
      return invalidBody('新建记录的请求体必须是 JSON 对象');
    }
    const seq = await repo.allocateSeq(projectId, key);
    const data = buildRecordData(collection.record, models, request.body || {}, idField, seq);
    const record = await repo.insertRecord(projectId, key, { key: String(seq), seq, data });
    return ok(201, record.data);
  }

  if (method === 'PUT' || method === 'PATCH') {
    if (!trailing) return invalidBody(`${method} 需要以路径参数定位单条记录`);
    if (request.body !== undefined && request.body !== null && !isPlainObject(request.body)) {
      return invalidBody('更新记录的请求体必须是 JSON 对象');
    }
    const existing = await repo.getRecord(projectId, key, trailing.value);
    if (!existing) return recordNotFound(idField, trailing.value);
    const idValue = existing.data[idField] ?? existing.seq;
    const data =
      method === 'PUT'
        ? buildRecordData(collection.record, models, request.body || {}, idField, idValue)
        : buildPatchedData(existing.data, request.body || {}, idField);
    const updated = await repo.updateRecord(projectId, key, trailing.value, data);
    return ok(200, updated.data);
  }

  if (method === 'DELETE') {
    if (!trailing) return invalidBody('DELETE 需要以路径参数定位单条记录');
    const deleted = await repo.deleteRecord(projectId, key, trailing.value);
    if (!deleted) return recordNotFound(idField, trailing.value);
    return ok(200, { deleted: true, [idField]: deleted.data[idField] });
  }

  return {
    status: 405,
    body: { error: { code: 'METHOD_NOT_ALLOWED', message: `资源集合不支持的方法：${method}` } },
    matchedScenario: null,
  };
}
