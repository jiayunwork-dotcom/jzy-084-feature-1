import { ValidationError } from '../errors.js';
import { pathToRegExp } from '../mock/dispatcher.js';

/**
 * Path-space ownership between ordinary interfaces and resource collections.
 *
 * A collection with basePath P owns the whole subtree:
 *   - P            (list / create)
 *   - P/<one-segment>   (item read / modify / remove)
 *
 * To keep dispatch deterministic, NO interface path may collide with that
 * subtree (any method), and two collections may not have equal or nested
 * base paths. Both directions are enforced at save time. Ordinary interfaces
 * among themselves keep the original path+method uniqueness rule
 * (services/uniqueness.js) — unchanged.
 */

function pathMatchesTemplate(template, pathname) {
  if (!template.includes(':')) return template === pathname;
  return pathToRegExp(template).test(pathname);
}

/** Is `pathname` a single-segment child of `basePath` (an item route)? */
export function isItemPath(basePath, pathname) {
  if (!pathname.startsWith(`${basePath}/`)) return false;
  const rest = pathname.slice(basePath.length + 1);
  return rest.length > 0 && !rest.includes('/');
}

/**
 * Does interface path template `apiPath` collide with the subtree owned by
 * collection `basePath`? Method-agnostic: any overlap is ambiguous.
 */
export function interfacePathCollidesWithCollection(apiPath, basePath) {
  // interface (static or :param template) matching the collection root
  if (pathMatchesTemplate(apiPath, basePath)) return true;
  // interface that IS a static item path, e.g. /api/articles/1
  if (isItemPath(basePath, apiPath)) return true;
  // interface :param template matching item routes, e.g. /api/articles/:id
  if (pathMatchesTemplate(apiPath, `${basePath}/__item__`)) return true;
  return false;
}

export function findInterfaceCollectionConflict(interfaces, collection) {
  return interfaces.find((api) =>
    interfacePathCollidesWithCollection(api.path, collection.basePath),
  ) || null;
}

export function assertNoInterfaceCollectionConflict(interfaces, collection) {
  const clash = findInterfaceCollectionConflict(interfaces, collection);
  if (clash) {
    throw new ValidationError('资源集合路径与已有接口冲突', [
      {
        path: 'basePath',
        message: `集合路径 ${collection.basePath} 与接口「${clash.name}」（${clash.method} ${clash.path}）的路由冲突，请调整路径`,
      },
    ]);
  }
}

/** Reverse direction: does a candidate interface collide with a collection? */
export function findCollectionInterfaceConflict(collections, input) {
  return collections.find((collection) =>
    interfacePathCollidesWithCollection(input.path, collection.basePath),
  ) || null;
}

export function assertNoCollectionInterfaceConflict(collections, input) {
  const clash = findCollectionInterfaceConflict(collections, input);
  if (clash) {
    throw new ValidationError('接口路径与已有资源集合冲突', [
      {
        path: 'path',
        message: `${input.method.toUpperCase()} ${input.path} 落在资源集合「${clash.name}」（${clash.basePath}）的路由范围内，请调整路径`,
      },
    ]);
  }
}

/**
 * Collections must not share or nest base paths (ownership would be
 * ambiguous).
 */
export function findCollectionPathConflict(collections, basePath, excludeId = null) {
  return collections.find((other) => {
    if (other.id === excludeId) return false;
    return (
      other.basePath === basePath
      || other.basePath.startsWith(`${basePath}/`)
      || basePath.startsWith(`${other.basePath}/`)
    );
  }) || null;
}

export function assertCollectionPathUnique(collections, basePath, excludeId = null) {
  const clash = findCollectionPathConflict(collections, basePath, excludeId);
  if (clash) {
    throw new ValidationError('资源集合路径冲突', [
      {
        path: 'basePath',
        message: `集合路径 ${basePath} 与已有集合「${clash.name}」（${clash.basePath}）相同或相互嵌套`,
      },
    ]);
  }
}
