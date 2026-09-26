import { ValidationError } from '../errors.js';
import { findRouteSpaceConflict, describeConflict } from './resource-routes.js';

/**
 * Path+method uniqueness within a project. Pure so the rule can be tested
 * independently of persistence.
 * @param {Array<{id:string,name:string,path:string,method:string}>} existing
 * @param {{path:string, method:string}} input normalized (uppercase method)
 * @param {string|null} excludeId id being updated
 */
export function findDuplicatePathMethod(existing, input, excludeId = null) {
  return existing.find(
    (api) =>
      api.id !== excludeId &&
      (api.kind || 'standard') !== 'resource' &&
      (input.kind || 'standard') !== 'resource' &&
      api.path === input.path &&
      api.method.toUpperCase() === input.method.toUpperCase(),
  );
}

export function assertPathMethodUnique(existing, input, excludeId = null) {
  const duplicate = findDuplicatePathMethod(existing, input, excludeId);
  if (duplicate) {
    throw new ValidationError('同项目内路径与方法的组合不允许重复', [
      {
        path: 'path',
        message: `${input.method.toUpperCase()} ${input.path} 已被接口「${duplicate.name}」占用`,
      },
    ]);
  }
}

/**
 * Resource collections occupy both the base path and base/:id. Reject any
 * definition (standard or resource) that overlaps that space.
 */
export function assertRouteSpaceAvailable(existing, input, excludeId = null) {
  const conflict = findRouteSpaceConflict(existing, input, excludeId);
  if (conflict) {
    throw new ValidationError('路径与已有资源集合的路由空间冲突', [
      { path: 'path', message: describeConflict(conflict, input) },
    ]);
  }
}
