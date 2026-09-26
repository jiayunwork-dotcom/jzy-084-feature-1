import * as interfaceRepo from '../db/interface-repo.js';
import { generateNode } from './data-generator.js';
import { selectScenario } from './scenario-matcher.js';
import { getModelMap } from '../services/model-service.js';
import { dispatchCollection } from './collection-dispatcher.js';

/**
 * Mock request dispatcher.
 *
 * Two interface shapes share the /mock surface:
 *  1. stateful resource collections — persistent record sets with real
 *     list/detail/create/update/delete semantics (see collection-dispatcher);
 *  2. ordinary stateless interfaces — scenarios are evaluated in declared
 *     order and data is freshly generated from the first match (or the
 *     default response).
 *
 * Their path spaces are mutually exclusive (validated at save time), so
 * collection routing is attempted first and ordinary interfaces never see
 * collection paths.
 */

export function pathToRegExp(pathTemplate) {
  const pattern = pathTemplate
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) return '([^/]+)';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${pattern}$`);
}

export async function findMatchingInterface(projectId, method, pathname) {
  const apis = await interfaceRepo.listInterfacesForMock(projectId);
  const sameMethod = apis.filter((api) => api.method === method);
  // static (parameterless) paths take precedence over patterns
  sameMethod.sort((a, b) => Number(a.path.includes(':')) - Number(b.path.includes(':')));
  for (const api of sameMethod) {
    if (api.path === pathname) return api;
    if (api.path.includes(':') && pathToRegExp(api.path).test(pathname)) return api;
  }
  return null;
}

/**
 * Handle an incoming mock request.
 * @returns {{ status: number, body: any, matchedScenario: string|null }}
 */
export async function dispatch(projectId, request) {
  const method = request.method;
  const pathname = request.path;

  // 1. Stateful resource collections own their whole path subtree.
  const collectionResult = await dispatchCollection(projectId, request);
  if (collectionResult) return collectionResult;

  // 2. Ordinary stateless interfaces: method + path-pattern lookup.
  const api = await findMatchingInterface(projectId, method, pathname);
  if (!api) {
    return {
      status: 404,
      body: { error: { code: 'MOCK_NOT_FOUND', message: `No mock defined for ${method} ${pathname}` } },
      matchedScenario: null,
    };
  }

  const models = await getModelMap(projectId);
  const scenario = selectScenario(api.scenarios, request);
  const responseNode = scenario ? scenario.response : api.defaultResponse;
  // Responses are stored as { fields: [...] }; generate them as objects.
  const body = generateNode({ type: 'object', fields: responseNode.fields || [] }, models);

  return {
    status: scenario?.statusCode && Number.isInteger(scenario.statusCode) ? scenario.statusCode : 200,
    body,
    matchedScenario: scenario ? scenario.name : null,
  };
}
