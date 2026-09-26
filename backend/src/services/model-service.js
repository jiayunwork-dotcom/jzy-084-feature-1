import { ValidationError, NotFoundError } from '../errors.js';
import { validateModelInput } from './validator.js';
import { findNamedCycles, collectRefs } from './cycle-detector.js';
import * as modelRepo from '../db/model-repo.js';
import * as interfaceRepo from '../db/interface-repo.js';

export async function listModels(projectId) {
  return modelRepo.listModels(projectId);
}

/** Build the current model graph with the candidate model overlaid. */
function buildModelMap(existingModels, candidate) {
  const map = new Map(existingModels.map((m) => [m.id, m]));
  if (candidate) {
    map.set(candidate.id, { id: candidate.id, name: candidate.name, fields: candidate.fields });
  }
  return map;
}

export async function createModel(projectId, input) {
  const existingModels = await modelRepo.listModels(projectId);

  if (existingModels.some((m) => m.name === input.name)) {
    throw new ValidationError('模型名称在本项目中已存在', [
      { path: 'name', message: `模型名称重复：${input.name}` },
    ]);
  }

  // Refs must point at already-persisted models; dangling refs are rejected.
  const modelIds = new Set(existingModels.map((m) => m.id));
  validateModelInput(input, modelIds);

  // Overlay the candidate with a temporary id so cycles introduced by the
  // new model (it cannot reference itself before it has an id, but it can
  // close a loop via existing models) are caught before anything is written.
  const tempId = '__candidate__';
  const map = buildModelMap(existingModels, {
    id: tempId,
    name: input.name,
    fields: input.fields,
  });
  assertNoCycles(map);

  return modelRepo.createModel(projectId, { name: input.name, fields: input.fields });
}

export async function updateModel(projectId, id, input) {
  const existing = await modelRepo.getModel(projectId, id);
  if (!existing) throw new NotFoundError('模型不存在');

  const others = (await modelRepo.listModels(projectId)).filter((m) => m.id !== id);
  if (others.some((m) => m.name === input.name)) {
    throw new ValidationError('模型名称在本项目中已存在', [
      { path: 'name', message: `模型名称重复：${input.name}` },
    ]);
  }

  const modelIds = new Set([...others.map((m) => m.id), id]);
  validateModelInput(input, modelIds);

  const map = buildModelMap(others, { id, name: input.name, fields: input.fields });
  assertNoCycles(map);

  const updated = await modelRepo.updateModel(projectId, id, input);
  if (!updated) throw new NotFoundError('模型不存在');
  return updated;
}

function assertNoCycles(modelMap) {
  const cycles = findNamedCycles(modelMap);
  if (cycles.length > 0) {
    const details = cycles.map((cycle) => {
      const chain = cycle.names.join(' -> ');
      return {
        path: 'fields',
        message: `检测到公共模型循环引用：${chain}`,
      };
    });
    throw new ValidationError('公共模型之间存在循环引用', details, 'CIRCULAR_REFERENCE');
  }
}

export async function deleteModel(projectId, id) {
  const existing = await modelRepo.getModel(projectId, id);
  if (!existing) throw new NotFoundError('模型不存在');

  // Reject deletion when other models or interfaces still reference it.
  const allModels = await modelRepo.listModels(projectId);
  const referencedByModel = allModels.find(
    (m) => m.id !== id && collectRefs({ type: 'object', fields: m.fields }).has(id),
  );
  if (referencedByModel) {
    throw new ValidationError('模型仍被引用，无法删除', [
      { path: 'id', message: `模型 ${existing.name} 被模型 ${referencedByModel.name} 引用` },
    ]);
  }

  const interfaces = await interfaceRepo.listInterfaces(projectId);
  for (const api of interfaces) {
    if (collectRefs({ type: 'object', fields: api.defaultResponse.fields || [] }).has(id)) {
      throw new ValidationError('模型仍被引用，无法删除', [
        { path: 'id', message: `模型 ${existing.name} 被接口 ${api.name} 的默认响应引用` },
      ]);
    }
    for (const scenario of api.scenarios) {
      if (collectRefs({ type: 'object', fields: scenario.response?.fields || [] }).has(id)) {
        throw new ValidationError('模型仍被引用，无法删除', [
          { path: 'id', message: `模型 ${existing.name} 被接口 ${api.name} 的场景「${scenario.name}」引用` },
        ]);
      }
    }
  }

  await modelRepo.deleteModel(projectId, id);
}

export async function getModelMap(projectId) {
  const models = await modelRepo.listModels(projectId);
  return new Map(models.map((m) => [m.id, m]));
}
