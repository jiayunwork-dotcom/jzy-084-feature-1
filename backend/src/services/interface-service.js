import { NotFoundError } from '../errors.js';
import { validateInterfaceInput, RESOURCE_DEFAULTS } from './validator.js';
import { assertPathMethodUnique, assertRouteSpaceAvailable } from './uniqueness.js';
import * as interfaceRepo from '../db/interface-repo.js';
import * as modelRepo from '../db/model-repo.js';
import * as resourceRepo from '../db/resource-repo.js';

export async function listInterfaces(projectId) {
  return interfaceRepo.listInterfaces(projectId);
}

export async function getInterface(projectId, id) {
  const api = await interfaceRepo.getInterface(projectId, id);
  if (!api) throw new NotFoundError('接口不存在');
  return api;
}

/**
 * Normalize raw input into a persistable definition.
 *
 * Resource collections answer every method on the base/item routes, but the
 * interfaces table keeps (path, method) unique and default_response NOT NULL;
 * a resource is therefore stored with method GET and a mirror of its record
 * fields in default_response (also what model-deletion reference scans read).
 */
function normalizeResource(input) {
  const config = input.resourceConfig || {};
  const resourceConfig = {
    fields: config.fields || [],
    seedCount: Number.isInteger(config.seedCount) ? config.seedCount : RESOURCE_DEFAULTS.seedCount,
    idField: config.idField || RESOURCE_DEFAULTS.idField,
    pageSize: Number.isInteger(config.pageSize) ? config.pageSize : RESOURCE_DEFAULTS.pageSize,
  };
  return {
    name: input.name,
    path: input.path,
    method: 'GET',
    scenarios: input.scenarios || [],
    kind: 'resource',
    resourceConfig,
    defaultResponse: { fields: resourceConfig.fields },
  };
}

async function prepareInput(projectId, input, excludeId = null) {
  const isResource = input.kind === 'resource';
  const normalized = isResource
    ? normalizeResource(input)
    : {
        ...input,
        kind: 'standard',
        resourceConfig: null,
        method: (input.method || '').toUpperCase(),
        scenarios: input.scenarios || [],
      };
  const models = await modelRepo.listModels(projectId);
  validateInterfaceInput(normalized, new Set(models.map((m) => m.id)));
  const existing = await interfaceRepo.listInterfaces(projectId);
  assertPathMethodUnique(existing, normalized, excludeId);
  assertRouteSpaceAvailable(existing, normalized, excludeId);
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
  if (normalized.kind === 'resource') {
    // Definition changed: previous live state is stale. Drop it; the new
    // seed is generated on the next access (or at startup).
    await resourceRepo.resetState(updated.id);
  }
  return updated;
}

export async function deleteInterface(projectId, id) {
  const existing = await interfaceRepo.getInterface(projectId, id);
  if (!existing) throw new NotFoundError('接口不存在');
  await interfaceRepo.deleteInterface(projectId, id);
}
