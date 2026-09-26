import { ResourceNotFoundError, BadRequestError } from '../errors.js';
import * as repo from '../db/collection-repo.js';
import { getModelMap } from '../services/model-service.js';
import {
  generateSeedRecords,
  generateRecord,
  buildRecordFromBody,
  applyFullReplacement,
  applyPartialUpdate,
  knownFieldNames,
} from './resource-schema.js';
import { paginateRecords } from './collection-router.js';

/**
 * Stateful resource-collection store.
 *
 * This module is the ONLY place that mutates collection contents. All state
 * lives in PostgreSQL alongside definitions; nothing record-shaped is cached
 * in process memory, so a restart loses neither records nor allocated ids.
 *
 * Consistency strategy:
 *  - a per-collection in-process mutex serializes every write sequence
 *    (reserve id -> insert -> persist counter), guaranteeing no duplicate ids,
 *    no lost writes and exact counts under concurrent requests;
 *  - each sequence additionally runs in one DB transaction (atomic on real
 *    PostgreSQL), and (collection_id, record_id) is a primary key, so the
 *    invariant also holds at the storage level;
 *  - ids are monotonic and never reused, so adding/removing other records can
 *    never shift an existing record's identity.
 */

const lockChains = new Map();

/**
 * Serialize async work per collection key using a tail-promise queue.
 * Each caller chains onto the previous one; a failed predecessor never
 * blocks the next writer. The map entry is pruned once the chain drains.
 */
function withCollectionLock(collectionId, work) {
  const previous = lockChains.get(collectionId) || Promise.resolve();
  const result = previous
    .catch(() => {})
    .then(() => repo.withTransaction((client) => work(client)));
  // Settled tail used purely for queueing; prune it once fully drained.
  const tail = result.then(
    () => { if (lockChains.get(collectionId) === tail) lockChains.delete(collectionId); },
    () => { if (lockChains.get(collectionId) === tail) lockChains.delete(collectionId); },
  );
  // If a newer write arrives, it replaces the map entry synchronously before
  // this tail's microtask runs, so an in-flight chain is never pruned early.
  lockChains.set(collectionId, tail);
  return result;
}

function loadModels(projectId) {
  return getModelMap(projectId);
}

async function requireCollection(collectionId, executor) {
  const collection = await repo.getCollectionById(collectionId, executor);
  if (!collection) throw new ResourceNotFoundError('资源集合不存在');
  return collection;
}

function parseItemId(rawId) {
  // Stable ids are positive integers. Malformed ids are "not found" rather
  // than fabricated or coerced.
  if (!/^\d+$/.test(rawId)) {
    throw new ResourceNotFoundError(`id 不存在：${rawId}`);
  }
  return Number(rawId);
}

function assertRecordExists(exists, id) {
  if (!exists) throw new ResourceNotFoundError(`id 不存在：${id}`);
}

function assertPlainObjectBody(body) {
  if (body === undefined || body === null) return;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('请求体必须是 JSON 对象');
  }
}

// ---------------------------------------------------------------------------
// management (called by the collection service)
// ---------------------------------------------------------------------------

/** Generate and persist the initial seed batch for a brand-new collection. */
export async function seedCollection(collectionId, recordSchema, seedCount, projectId, executor) {
  const models = await loadModels(projectId);
  const seed = generateSeedRecords(recordSchema, seedCount, models);
  await repo.replaceAllRecords(collectionId, seed, seedCount + 1, executor);
  // Keep an exact snapshot so reset replays the same records, not new random.
  await repo.persistSeedSnapshot(collectionId, seed, seedCount + 1, executor);
  return seed;
}

/** Restore a collection to the exact snapshot captured at definition time. */
export async function resetToSeed(projectId, collectionId) {
  return withCollectionLock(collectionId, async (client) => {
    const collection = await requireCollection(collectionId, client);
    // Deep-copy the snapshot so callers never mutate persisted state.
    const seed = JSON.parse(JSON.stringify(collection.seedRecords || []));
    await repo.replaceAllRecords(collectionId, seed, seed.length + 1, client);
    return seed.map((r) => r.data);
  });
}

// ---------------------------------------------------------------------------
// CRUD on the mock request path
// ---------------------------------------------------------------------------

export async function listCollection(collectionId, query) {
  const collection = await repo.getCollectionById(collectionId);
  if (!collection) throw new ResourceNotFoundError('资源集合不存在');
  const rows = await repo.listRecords(collectionId);
  return paginateRecords(rows, query);
}

export async function getCollectionItem(collectionId, rawId) {
  const id = parseItemId(rawId);
  const data = await repo.getRecord(collectionId, id);
  if (!data) throw new ResourceNotFoundError(`id 不存在：${id}`);
  return data;
}

export async function createCollectionItem(collectionId, body) {
  assertPlainObjectBody(body);
  return withCollectionLock(collectionId, async (client) => {
    const collection = await requireCollection(collectionId, client);
    const models = await loadModels(collection.projectId);
    const nextId = collection.nextId;
    await repo.reserveNextId(collectionId, nextId, client);
    const record = buildRecordFromBody(collection.recordSchema, models, nextId, body);
    await repo.insertRecord(collectionId, nextId, record, client);
    return { status: 201, data: record };
  });
}

export async function replaceCollectionItem(collectionId, rawId, body) {
  const id = parseItemId(rawId);
  assertPlainObjectBody(body);
  return withCollectionLock(collectionId, async (client) => {
    const collection = await requireCollection(collectionId, client);
    const current = await repo.getRecord(collectionId, id, client);
    assertRecordExists(!!current, id);
    const next = applyFullReplacement(current, body || {}, collection.recordSchema);
    await repo.updateRecordData(collectionId, id, next, client);
    return next;
  });
}

export async function patchCollectionItem(collectionId, rawId, body) {
  const id = parseItemId(rawId);
  assertPlainObjectBody(body);
  return withCollectionLock(collectionId, async (client) => {
    const collection = await requireCollection(collectionId, client);
    const current = await repo.getRecord(collectionId, id, client);
    assertRecordExists(!!current, id);
    const next = applyPartialUpdate(current, body || {}, collection.recordSchema);
    await repo.updateRecordData(collectionId, id, next, client);
    return next;
  });
}

export async function deleteCollectionItem(collectionId, rawId) {
  const id = parseItemId(rawId);
  return withCollectionLock(collectionId, async (client) => {
    await requireCollection(collectionId, client);
    const removed = await repo.deleteRecord(collectionId, id, client);
    assertRecordExists(removed, id);
  });
}

export { knownFieldNames };
