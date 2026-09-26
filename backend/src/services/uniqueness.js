import { ValidationError } from '../errors.js';

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
