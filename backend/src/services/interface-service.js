import { ValidationError, NotFoundError } from '../errors.js';
import { validateInterfaceInput } from './validator.js';
import { assertPathMethodUnique } from './uniqueness.js';
import * as interfaceRepo from '../db/interface-repo.js';
import * as modelRepo from '../db/model-repo.js';

export async function listInterfaces(projectId) {
  return interfaceRepo.listInterfaces(projectId);
}

export async function getInterface(projectId, id) {
  const api = await interfaceRepo.getInterface(projectId, id);
  if (!api) throw new NotFoundError('接口不存在');
  return api;
}

/**
 * Canonical JSON for comparing record schemas: object keys sorted and the
 * client-side scratch `id` props ignored, so two interfaces that declare the
 * same record shape through different editor sessions compare equal.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === 'id') continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

function normalizeCollection(input) {
  const raw = input.collection || {};
  return {
    collectionKey: raw.collectionKey,
    idField: raw.idField || 'id',
    seedCount: raw.seedCount === undefined || raw.seedCount === null ? 5 : Number(raw.seedCount),
    record: raw.record,
  };
}

/**
 * Interfaces that share a collectionKey operate on ONE collection state, so
 * they must agree on the record shape, id field and seed count.
 */
function assertCollectionConfigConsistent(existing, input, excludeId) {
  const { collection } = input;
  const canonicalRecord = JSON.stringify(canonicalize(collection.record));
  const sibling = existing.find(
    (api) =>
      api.id !== excludeId &&
      api.kind === 'collection' &&
      api.collection?.collectionKey === collection.collectionKey,
  );
  if (!sibling) return;
  const other = sibling.collection;
  const consistent =
    other.idField === collection.idField &&
    Number(other.seedCount) === Number(collection.seedCount) &&
    JSON.stringify(canonicalize(other.record)) === canonicalRecord;
  if (!consistent) {
    throw new ValidationError('同一资源集合的定义不一致', [
      {
        path: 'collection',
        message: `集合「${collection.collectionKey}」已被接口「${sibling.name}」使用：记录结构、标识字段与种子数量必须与它完全一致`,
      },
    ]);
  }
}

async function prepareInput(projectId, input, excludeId = null) {
  const kind = input.kind || 'stateless';
  const normalized = {
    ...input,
    method: (input.method || '').toUpperCase(),
    kind,
    defaultResponse: input.defaultResponse || { fields: [] },
    scenarios: input.scenarios || [],
  };
  if (kind === 'collection') {
    normalized.collection = normalizeCollection(input);
  } else {
    normalized.collection = null;
  }
  const models = await modelRepo.listModels(projectId);
  validateInterfaceInput(normalized, new Set(models.map((m) => m.id)));
  const existing = await interfaceRepo.listInterfaces(projectId);
  assertPathMethodUnique(existing, normalized, excludeId);
  if (normalized.kind === 'collection') {
    assertCollectionConfigConsistent(existing, normalized, excludeId);
  }
  return normalized;
}

export async function createInterface(projectId, input) {
  const normalized = await prepareInput(projectId, input);
  return interfaceRepo.createInterface(projectId, normalized);
}

export async function updateInterface(id, projectId, input) {
  const existing = await interfaceRepo.getInterface(projectId, id);
  if (!existing) throw new NotFoundError('接口不存在');
  const normalized = await prepareInput(projectId, input, id);
  const updated = await interfaceRepo.updateInterface(projectId, id, normalized);
  return updated;
}

export async function deleteInterface(projectId, id) {
  const existing = await interfaceRepo.getInterface(projectId, id);
  if (!existing) throw new NotFoundError('接口不存在');
  await interfaceRepo.deleteInterface(projectId, id);
}
