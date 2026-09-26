/**
 * Resource collection route matching — pure and independently testable.
 *
 * A collection with basePath "/api/articles" owns exactly:
 *   GET/POST                   /api/articles        (list / create)
 *   GET/PUT/PATCH/DELETE       /api/articles/:id    (item read/modify/remove)
 *
 * Collection CRUD does not use :param templates: the second path segment is
 * always an item id. Anything deeper (e.g. /api/articles/1/comments) is not
 * owned by this collection and falls through to normal interface matching.
 */

const COLLECTION_METHODS = new Set(['GET', 'POST']);
const ITEM_METHODS = new Set(['GET', 'PUT', 'PATCH', 'DELETE']);

/**
 * Resolve a request against one collection's routes.
 * @returns {{action:'collection'|'item', id?:string} | {unsupported:true, allowed:string[]} | null}
 */
export function matchCollectionRoute(collection, method, pathname) {
  const base = collection.basePath;
  let action = null;
  let id = null;

  if (pathname === base) {
    action = 'collection';
  } else if (pathname.startsWith(`${base}/`)) {
    const rest = pathname.slice(base.length + 1);
    if (rest.length > 0 && !rest.includes('/')) {
      action = 'item';
      id = decodeURIComponent(rest);
    }
  }
  if (!action) return null;

  const allowed = action === 'collection'
    ? ['GET', 'POST']
    : ['GET', 'PUT', 'PATCH', 'DELETE'];

  if (action === 'collection' && !COLLECTION_METHODS.has(method)) {
    return { unsupported: true, allowed };
  }
  if (action === 'item' && !ITEM_METHODS.has(method)) {
    return { unsupported: true, allowed };
  }
  return action === 'item' ? { action, id } : { action };
}

/** Pagination + basic field-value filtering over stored records (pure). */
export function paginateRecords(records, query = {}) {
  let items = records;

  // Basic filtering: scalar equality on top-level record fields.
  // page / pageSize are reserved for pagination, never treated as filters.
  for (const [key, expected] of Object.entries(query)) {
    if (key === 'page' || key === 'pageSize') continue;
    if (expected === undefined || expected === '') continue;
    items = items.filter((record) => {
      const actual = record.data?.[key];
      if (actual === null || actual === undefined) return false;
      return String(actual) === String(expected);
    });
  }

  const total = items.length;
  const pageSize = clampPageSize(query.pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  let page = Number.parseInt(query.page, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (page > totalPages) page = totalPages;

  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize).map((r) => r.data),
    pagination: { page, pageSize, total, totalPages },
  };
}

function clampPageSize(raw) {
  let size = Number.parseInt(raw, 10);
  if (!Number.isInteger(size) || size < 1) size = 20;
  return Math.min(size, 100);
}
