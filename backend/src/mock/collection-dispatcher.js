import * as collectionRepo from '../db/collection-repo.js';
import { matchCollectionRoute } from './collection-router.js';
import * as store from './collection-store.js';

/**
 * Stateful resource-collection request path.
 *
 * Kept fully separate from the stateless dispatcher: this module only runs
 * when a collection owns the request path, and every operation reads/mutates
 * the same persisted record set instead of generating one-shot data.
 *
 * Precedence vs. conditional scenarios is defined by path ownership:
 * interface paths and collection path subtrees are mutually exclusive
 * (enforced at save time), so a request handled here is ALWAYS collection
 * CRUD — conditional scenarios belong to ordinary interfaces and never fire
 * on collection paths.
 */

/**
 * @returns {null | {status:number, body:any, matchedScenario:null}}
 *   null when no collection owns the path (caller falls through to the
 *   stateless dispatcher).
 */
export async function dispatchCollection(projectId, request) {
  const method = request.method;
  const pathname = request.path;

  const collection = await collectionRepo.findCollectionForPath(
    projectId,
    pathname,
  );
  if (!collection) return null;

  const match = matchCollectionRoute(collection, method, pathname);
  if (!match) return null; // deeper sub-resource: not ours

  if (match.unsupported) {
    return {
      status: 405,
      body: {
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: `资源集合路径不支持 ${method}，允许的方法：${match.allowed.join(', ')}`,
        },
      },
      matchedScenario: null,
      headers: { Allow: match.allowed.join(', ') },
    };
  }

  if (match.action === 'collection') {
    if (method === 'GET') {
      const { items, pagination } = await store.listCollection(
        collection.id,
        request.query,
      );
      return { status: 200, body: { data: items, pagination }, matchedScenario: null };
    }
    // POST
    const created = await store.createCollectionItem(collection.id, request.body);
    return { status: created.status, body: created.data, matchedScenario: null };
  }

  // item route
  const rawId = match.id;
  if (method === 'GET') {
    const data = await store.getCollectionItem(collection.id, rawId);
    return { status: 200, body: data, matchedScenario: null };
  }
  if (method === 'PUT') {
    const data = await store.replaceCollectionItem(collection.id, rawId, request.body);
    return { status: 200, body: data, matchedScenario: null };
  }
  if (method === 'PATCH') {
    const data = await store.patchCollectionItem(collection.id, rawId, request.body);
    return { status: 200, body: data, matchedScenario: null };
  }
  // DELETE
  await store.deleteCollectionItem(collection.id, rawId);
  return { status: 204, body: null, matchedScenario: null };
}
