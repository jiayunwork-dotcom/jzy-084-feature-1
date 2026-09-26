import * as interfaceRepo from '../db/interface-repo.js';
import { generateNode } from './data-generator.js';
import { selectScenario } from './scenario-matcher.js';
import { getModelMap } from '../services/model-service.js';

/**
 * Mock request dispatcher.
 *
 * Looks up the interface by method + path pattern (:param segments match any
 * single non-slash segment), evaluates scenarios in declared order, and
 * generates data from the first match (or the default response).
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
