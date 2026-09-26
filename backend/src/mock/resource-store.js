import { generateNode } from './data-generator.js';
import * as resourceRepo from '../db/resource-repo.js';

/**
 * Stateful resource-collection engine.
 *
 * This module owns the *stateful* side of mock dispatch; it deliberately does
 * no interface lookup or scenario matching (see resource-dispatcher.js). Fake
 * values always come from the same data-generator used by stateless standard
 * interfaces — there is no second generator.
 *
 * State model (persisted in resource_states / resource_records):
 *  - on first access the collection is seeded once; generated values plus the
 *    platform-assigned ids are frozen as the seed snapshot;
 *  - every later read reflects the cumulative effect of all writes;
 *  - ids are allocated monotonically by an atomic DB counter and stay fixed
 *    for a record's lifetime (deletion frees the row, never the id);
 *  - reset() restores the exact seed snapshot.
 */

const RESERVED_QUERY_KEYS = new Set(['page', 'pageSize', 'page_size', 'size']);
const SEED_WAIT_TIMEOUT_MS = 10_000;
const SEED_WAIT_INTERVAL_MS = 20;

const inFlightSeeds = new Map();

function topLevelFieldMap(fields) {
  const map = new Map();
  for (const field of fields || []) {
    if (field && field.name) map.set(field.name, field);
  }
  return map;
}

/** Coerce the platform-allocated id to the declared id field's storage type. */
export function coerceIdForField(field, id) {
  if (field?.type === 'string') return String(id);
  return id;
}

/**
 * Build one record from its field schema using the standard generator, then
 * overlay client-provided top-level values and finally stamp the stable id.
 *
 * "Generated-once" fields that the client does not provide come straight from
 * the generator and freeze at whatever it produced for this call.
 */
export function buildRecordFromSchema(fields, models, body = {}, { id, idField } = {}) {
  const record = generateNode({ type: 'object', fields: fields || [] }, models);
  const fieldMap = topLevelFieldMap(fields);
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (key === idField) continue; // identity is platform-assigned
      if (fieldMap.has(key)) record[key] = value;
    }
  }
  if (idField && id !== undefined) {
    record[idField] = coerceIdForField(fieldMap.get(idField), id);
  }
  return record;
}

/** Extract exact-match filters from a query object (page params reserved). */
export function extractEqualFilters(query = {}) {
  const equal = {};
  for (const [key, raw] of Object.entries(query)) {
    if (RESERVED_QUERY_KEYS.has(key)) continue;
    if (raw === undefined || raw === '') continue;
    equal[key] = Array.isArray(raw) ? raw[0] : raw;
  }
  return equal;
}

export function recordMatches(record, equal) {
  return Object.entries(equal).every(([key, value]) => {
    if (!(key in record)) return false;
    const actual = record[key];
    if (typeof actual === 'object') return false;
    return String(actual) === String(value);
  });
}

export function filterRecords(records, equal) {
  const entries = Object.entries(equal);
  if (entries.length === 0) return records;
  return records.filter((record) => recordMatches(record, equal));
}

export function parsePagination(query = {}, defaultPageSize) {
  let page = Number.parseInt(query.page, 10);
  let pageSize = Number.parseInt(query.pageSize ?? query.page_size ?? query.size, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = defaultPageSize;
  pageSize = Math.min(pageSize, 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginateRecords(records, { page, pageSize }) {
  const total = records.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: records.slice(start, start + pageSize),
    pagination: { page, pageSize, total, totalPages },
  };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function waitForInitialization(interfaceId) {
  const deadline = Date.now() + SEED_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, SEED_WAIT_INTERVAL_MS));
    // eslint-disable-next-line no-await-in-loop
    const state = await resourceRepo.getState(interfaceId);
    if (state?.initialized) return;
    if (!state?.seeding) {
      // The seeder vanished (crashed or rolled back); caller should retry.
      throw new Error('resource seeding interrupted');
    }
  }
  throw new Error('timed out waiting for resource seed');
}

async function seedCollection(api, models) {
  const claimed = await resourceRepo.tryStartSeeding(api.id);
  if (!claimed) {
    await waitForInitialization(api.id);
    return;
  }
  try {
    const { fields, seedCount, idField } = api.resourceConfig;
    const records = [];
    for (let index = 0; index < seedCount; index += 1) {
      const id = index + 1;
      const data = buildRecordFromSchema(fields, models, {}, { id, idField });
      records.push({ recordId: String(id), seq: id, data });
    }
    await resourceRepo.commitSeed(api.id, records);
  } catch (err) {
    await resourceRepo.markSeedingFailed(api.id);
    throw err;
  }
}

/**
 * Guarantee the collection is seeded before any read/write. Concurrent first
 * accesses within this process share one seeding promise; across processes the
 * seeding flag + conditional UPDATE in the repo elect a single seeder.
 */
export async function ensureSeeded(api, models) {
  await resourceRepo.ensureStateRow(api.id);
  let state = await resourceRepo.getState(api.id);
  if (state?.initialized) return;

  // Retry loop covers the rare "seeder crashed before finishing" case.
  for (;;) {
    const inFlight = inFlightSeeds.get(api.id);
    if (inFlight) {
      await inFlight.catch(() => {});
      state = await resourceRepo.getState(api.id);
      if (state?.initialized) return;
    }
    const attempt = seedCollection(api, models).catch(async (err) => {
      // Someone else may have seeded while we failed; re-check before throwing.
      const latest = await resourceRepo.getState(api.id).catch(() => null);
      if (latest?.initialized) return;
      throw err;
    });
    inFlightSeeds.set(api.id, attempt);
    try {
      await attempt;
      return;
    } catch (err) {
      if (inFlightSeeds.get(api.id) === attempt) inFlightSeeds.delete(api.id);
      // Another seeder might have taken over; loop and wait for it.
      const latest = await resourceRepo.getState(api.id).catch(() => null);
      if (latest?.initialized) return;
      if (latest && !latest.seeding) continue; // claim is free: retry
      try {
        await waitForInitialization(api.id);
        return;
      } catch {
        continue;
      }
    } finally {
      if (inFlightSeeds.get(api.id) === attempt) inFlightSeeds.delete(api.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Structured outcomes
// ---------------------------------------------------------------------------

const notFound = (recordId) => ({
  status: 404,
  body: {
    error: {
      code: 'RESOURCE_NOT_FOUND',
      message: `资源不存在：id=${recordId}`,
      resourceId: String(recordId),
    },
  },
});

const invalidBody = () => ({
  status: 400,
  body: {
    error: {
      code: 'INVALID_REQUEST_BODY',
      message: '请求体必须是 JSON 对象',
    },
  },
});

const methodNotAllowed = (allowed) => ({
  status: 405,
  headers: { Allow: allowed },
  body: {
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `该资源路径不支持此方法，允许：${allowed}`,
    },
  },
});

// ---------------------------------------------------------------------------
// Collection operations
// ---------------------------------------------------------------------------

export async function listCollection(api, request, models) {
  await ensureSeeded(api, models);
  const { idField, pageSize: defaultPageSize } = api.resourceConfig;
  const query = request.query || {};
  const { page, pageSize, offset } = parsePagination(query, defaultPageSize);

  // Filter on top-level primitive fields. Filtering happens in SQL so counts
  // and pages are always computed over the filtered set.
  const equal = extractEqualFilters(query);
  for (const key of Object.keys(equal)) {
    if (key === idField) {
      equal[key] = String(equal[key]);
    }
  }

  const { total, records } = await resourceRepo.listRecords(api.id, {
    limit: pageSize,
    offset,
    equal,
  });
  return {
    status: 200,
    body: {
      data: records.map((record) => record.data),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    },
  };
}

export async function getOne(api, recordId, models) {
  await ensureSeeded(api, models);
  const record = await resourceRepo.getRecord(api.id, recordId);
  if (!record) return notFound(recordId);
  return { status: 200, body: record.data };
}

export async function create(api, body, models) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalidBody();
  }
  await ensureSeeded(api, models);
  const { fields, idField } = api.resourceConfig;
  const id = await resourceRepo.allocateId(api.id);
  const data = buildRecordFromSchema(fields, models, body, { id, idField });
  try {
    await resourceRepo.insertRecord(api.id, { recordId: String(id), seq: id, data });
  } catch (err) {
    if (err?.code === '23505') {
      // Extremely unlikely (counter is monotonic); surface a clear error.
      return {
        status: 409,
        body: { error: { code: 'RESOURCE_ID_CONFLICT', message: `标识冲突：${id}` } },
      };
    }
    throw err;
  }
  return { status: 201, body: data, createdId: String(id) };
}

export async function replace(api, recordId, body, models) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalidBody();
  }
  await ensureSeeded(api, models);
  const existing = await resourceRepo.getRecord(api.id, recordId);
  if (!existing) return notFound(recordId);
  const { fields, idField } = api.resourceConfig;
  // Full replacement: unspecified fields are regenerated, identity is kept.
  const data = buildRecordFromSchema(fields, models, body, {
    id: existing.seq,
    idField,
  });
  const updated = await resourceRepo.updateRecordData(api.id, recordId, data);
  return { status: 200, body: updated.data };
}

export async function patch(api, recordId, body, models) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalidBody();
  }
  await ensureSeeded(api, models);
  const existing = await resourceRepo.getRecord(api.id, recordId);
  if (!existing) return notFound(recordId);
  const { fields, idField } = api.resourceConfig;
  const allowed = topLevelFieldMap(fields);
  const next = { ...existing.data };
  for (const [key, value] of Object.entries(body)) {
    if (key === idField) continue; // identity is immutable
    if (allowed.has(key)) next[key] = value;
  }
  const updated = await resourceRepo.updateRecordData(api.id, recordId, next);
  return { status: 200, body: updated.data };
}

export async function remove(api, recordId, models) {
  await ensureSeeded(api, models);
  const deleted = await resourceRepo.deleteRecord(api.id, recordId);
  if (!deleted) return notFound(recordId);
  return { status: 204, body: null };
}

export function methodNotAllowedOnCollection() {
  return methodNotAllowed('GET, POST');
}

export function methodNotAllowedOnItem() {
  return methodNotAllowed('GET, PUT, PATCH, DELETE');
}

// ---------------------------------------------------------------------------
// Management: status + reset to seed
// ---------------------------------------------------------------------------

export async function getCollectionStatus(api, models) {
  await ensureSeeded(api, models);
  const [state, total] = await Promise.all([
    resourceRepo.getState(api.id),
    resourceRepo.countRecords(api.id),
  ]);
  return {
    initialized: true,
    total,
    seedCount: api.resourceConfig.seedCount,
    nextId: state?.nextId ?? null,
  };
}

/**
 * Restore the exact initial seed ("as if never modified"). Seeds first when
 * the collection has never been accessed, then swaps live records for the
 * stored snapshot in one transaction.
 * @returns the restored seed records
 */
export async function resetCollection(api, models) {
  await ensureSeeded(api, models);
  const snapshot = await resourceRepo.resetToSnapshot(api.id);
  return (snapshot || []).map((record) => record.data);
}
