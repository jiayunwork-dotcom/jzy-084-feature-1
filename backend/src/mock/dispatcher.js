import * as interfaceRepo from '../db/interface-repo.js';
import { generateNode } from './data-generator.js';
import { selectScenario } from './scenario-matcher.js';
import { handleCollectionRequest } from './collection-engine.js';
import { getModelMap } from '../services/model-service.js';

/**
 * Mock request dispatcher.
 *
 * Looks up the interface by method + path pattern (:param segments match any
 * single non-slash segment), then routes:
 *
 *  1. A matched conditional scenario ALWAYS wins — for both stateless and
 *     collection interfaces — and answers with its statically generated
 *     response without touching collection state.
 *  2. Collection interfaces (kind = 'collection') with no scenario match are
 *     handled by the stateful collection engine (real reads/writes).
 *  3. Otherwise the stateless default response is generated on the fly.
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

function generateResponseBody(responseNode, models) {
  // Responses are stored as { fields: [...] }; generate them as objects.
  return generateNode({ type: 'object', fields: responseNode.fields || [] }, models);
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

  // Scenarios take precedence over both the default response and collection
  // reads/writes: the first matching scenario short-circuits.
  const scenario = selectScenario(api.scenarios, request);
  if (scenario) {
    const models = await getModelMap(projectId);
    return {
      status: scenario.statusCode && Number.isInteger(scenario.statusCode) ? scenario.statusCode : 200,
      body: generateResponseBody(scenario.response, models),
      matchedScenario: scenario.name,
    };
  }

  if (api.kind === 'collection' && api.collection) {
    return handleCollectionRequest(projectId, api, request);
  }

  const models = await getModelMap(projectId);
  return {
    status: 200,
    body: generateResponseBody(api.defaultResponse, models),
    matchedScenario: null,
  };
}
