import { NotFoundError } from '../errors.js';
import { validateCollectionInput } from './validator.js';
import {
  assertNoInterfaceCollectionConflict,
  assertCollectionPathUnique,
} from './collection-footprint.js';
import * as collectionRepo from '../db/collection-repo.js';
import { withTransaction } from '../db/collection-repo.js';
import * as interfaceRepo from '../db/interface-repo.js';
import * as modelRepo from '../db/model-repo.js';
import { seedCollection, resetToSeed } from '../mock/collection-store.js';

/**
 * Management-side lifecycle for resource collections.
 *
 * Seeding always goes through the shared fake-data generator (via the
 * collection store); the generated batch is captured as seed_records so
 * "reset" replays the exact original content instead of rolling new random
 * values.
 */

export async function listCollections(projectId) {
  return collectionRepo.listCollections(projectId);
}

export async function getCollection(projectId, id) {
  const collection = await collectionRepo.getCollection(projectId, id);
  if (!collection) throw new NotFoundError('资源集合不存在');
  return collection;
}

async function prepare(projectId, input, excludeId = null) {
  const normalized = {
    name: input.name,
    basePath: input.basePath,
    seedCount: Number(input.seedCount ?? 5),
    recordSchema: input.recordSchema,
  };
  const models = await modelRepo.listModels(projectId);
  validateCollectionInput(normalized, new Set(models.map((m) => m.id)));

  const existing = await collectionRepo.listCollections(projectId);
  assertCollectionPathUnique(existing, normalized.basePath, excludeId);

  const interfaces = await interfaceRepo.listInterfaces(projectId);
  assertNoInterfaceCollectionConflict(interfaces, normalized);
  return normalized;
}

export async function createCollection(projectId, input) {
  const normalized = await prepare(projectId, input);
  return withTransaction(async (client) => {
    const collection = await collectionRepo.createCollection(
      projectId,
      { ...normalized, seedRecords: [], nextId: 1 },
      client,
    );
    const seed = await seedCollection(
      collection.id,
      normalized.recordSchema,
      normalized.seedCount,
      projectId,
      client,
    );
    return collectionRepo.getCollection(projectId, collection.id, client);
  });
}

export async function updateCollection(projectId, id, input) {
  const existing = await collectionRepo.getCollection(projectId, id);
  if (!existing) throw new NotFoundError('资源集合不存在');

  const normalized = await prepare(projectId, input, id);
  return withTransaction(async (client) => {
    // Definition changed => the old contents no longer match the declared
    // shape: re-seed from the new definition and restart ids from 1.
    const updated = await collectionRepo.updateCollectionDefinition(
      projectId,
      id,
      { ...normalized, seedRecords: [], nextId: 1 },
      client,
    );
    const seed = await seedCollection(
      updated.id,
      normalized.recordSchema,
      normalized.seedCount,
      projectId,
      client,
    );
    // Persist the exact seed snapshot and counter alongside the definition.
    return collectionRepo.getCollection(projectId, id, client);
  });
}

export async function deleteCollection(projectId, id) {
  const existing = await collectionRepo.getCollection(projectId, id);
  if (!existing) throw new NotFoundError('资源集合不存在');
  await collectionRepo.deleteCollection(projectId, id);
}

/** Restore the collection to its initial seed state. */
export async function resetCollection(projectId, id) {
  const existing = await collectionRepo.getCollection(projectId, id);
  if (!existing) throw new NotFoundError('资源集合不存在');
  const data = await resetToSeed(projectId, id);
  return data;
}
