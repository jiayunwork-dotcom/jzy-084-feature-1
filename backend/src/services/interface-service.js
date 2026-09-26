import { NotFoundError } from '../errors.js';
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

async function prepareInput(projectId, input, excludeId = null) {
  const normalized = {
    ...input,
    method: (input.method || '').toUpperCase(),
    scenarios: input.scenarios || [],
  };
  const models = await modelRepo.listModels(projectId);
  validateInterfaceInput(normalized, new Set(models.map((m) => m.id)));
  const existing = await interfaceRepo.listInterfaces(projectId);
  assertPathMethodUnique(existing, normalized, excludeId);
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
