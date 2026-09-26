/**
 * Route-space rules for resource collections.
 *
 * A resource collection registered at base path P answers both:
 *   - P            (collection: GET list / POST create)
 *   - P/:id        (item: GET / PUT / PATCH / DELETE)
 * i.e. the exact base path and every path exactly one static segment below it.
 *
 * These rules are pure so the "path + method" uniqueness family of checks can
 * be tested independently of persistence.
 */

export function splitSegments(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const segments = path.split('/').slice(1);
  if (segments.some((segment) => segment === '')) return null;
  return segments;
}

/** Does `pathname` belong to a resource whose base is `basePath`? */
export function isPathInResource(basePath, pathname) {
  const base = splitSegments(basePath);
  const target = splitSegments(pathname);
  if (!base || !target) return false;
  if (target.length === base.length) return target.every((seg, i) => seg === base[i]);
  if (target.length === base.length + 1) {
    return base.every((seg, i) => target[i] === seg);
  }
  return false;
}

/**
 * Check a candidate (any kind) against all existing interfaces for a route
 * collision caused by a resource collection's occupied path space.
 *
 * @returns the conflicting interface, or null.
 */
export function findRouteSpaceConflict(existing, candidate, excludeId = null) {
  const candidateIsResource = candidate.kind === 'resource';
  for (const api of existing) {
    if (api.id === excludeId) continue;
    const existingIsResource = (api.kind || 'standard') === 'resource';
    if (!existingIsResource && !candidateIsResource) continue;

    // resource R's item segment may itself be a :param segment; if a
    // standard interface's path lies inside R's space, it is blocked.
    if (existingIsResource && isPathInResource(api.path, candidate.path)) return api;
    // candidate resource occupies space the existing interface lives in
    if (candidateIsResource && isPathInResource(candidate.path, api.path)) return api;
  }
  return null;
}

export function describeConflict(conflict, candidate) {
  if ((conflict.kind || 'standard') === 'resource') {
    return `路径 ${candidate.path} 落在资源集合「${conflict.name}」（基础路径 ${conflict.path}）的占用范围内，资源集合已接管该路径及其下的 /:id`;
  }
  return `资源集合基础路径 ${candidate.path} 与已有接口「${conflict.name}」的 ${conflict.method} ${conflict.path} 冲突`;
}
