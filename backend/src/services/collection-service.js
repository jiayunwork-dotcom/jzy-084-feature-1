import { NotFoundError } from '../errors.js';
import * as collectionRepo from '../db/collection-repo.js';
import * as interfaceRepo from '../db/interface-repo.js';
import { getModelMap } from './model-service.js';
import { generateSeedSnapshot } from '../mock/collection-engine.js';

/**
 * Management operations for resource collections (console UI):
 * overview of every collection and resetting one back to its seed state.
 */

export async function listCollections(projectId) {
  const [states, interfaces] = await Promise.all([
    collectionRepo.listCollectionStates(projectId),
    interfaceRepo.listInterfaces(projectId),
  ]);
  const byKey = new Map();

  // Collections declared by interfaces (possibly never accessed yet).
  for (const api of interfaces) {
    if (api.kind !== 'collection' || !api.collection?.collectionKey) continue;
    const key = api.collection.collectionKey;
    if (!byKey.has(key)) {
      byKey.set(key, {
        collectionKey: key,
        idField: api.collection.idField,
        seedCount: api.collection.seedCount,
        record: api.collection.record,
        interfaces: [],
        seeded: false,
        recordCount: null,
        nextSeq: null,
        seededAt: null,
      });
    }
    byKey.get(key).interfaces.push({
      id: api.id,
      name: api.name,
      method: api.method,
      path: api.path,
    });
  }

  // Overlay live state for collections that have been seeded.
  for (const state of states) {
    const entry =
      byKey.get(state.collectionKey) || {
        collectionKey: state.collectionKey,
        idField: state.idField,
        seedCount: state.seedCount,
        record: state.recordSchema,
        interfaces: [],
      };
    entry.seeded = true;
    entry.recordCount = state.recordCount;
    entry.nextSeq = state.nextSeq;
    entry.seededAt = state.seededAt;
    byKey.set(state.collectionKey, entry);
  }

  return [...byKey.values()].sort((a, b) => a.collectionKey.localeCompare(b.collectionKey));
}

/**
 * Restore a collection to its initial seed batch. Collections that were
 * defined but never requested are seeded on the spot (which IS the initial
 * state), so the reset button works before the first mock request too.
 */
export async function resetCollection(projectId, key) {
  let state = await collectionRepo.getState(projectId, key);
  if (!state) {
    const interfaces = await interfaceRepo.listInterfaces(projectId);
    const api = interfaces.find(
      (item) => item.kind === 'collection' && item.collection?.collectionKey === key,
    );
    if (!api) throw new NotFoundError(`资源集合不存在：${key}`);
    const models = await getModelMap(projectId);
    state = await collectionRepo.ensureSeeded(projectId, key, api.collection, () =>
      generateSeedSnapshot(api.collection, models),
    );
    return { collectionKey: key, reset: true, recordCount: state.seedSnapshot.records.length };
  }
  const reset = await collectionRepo.resetToSeed(projectId, key);
  return {
    collectionKey: key,
    reset: true,
    recordCount: reset.seedSnapshot.records.length,
  };
}
