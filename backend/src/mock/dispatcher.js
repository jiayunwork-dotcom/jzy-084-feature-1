import * as interfaceRepo from '../db/interface-repo.js';
import { generateNode } from './data-generator.js';
import { selectScenario } from './scenario-matcher.js';
import { getModelMap } from '../services/model-service.js';
import { dispatchResource } from './resource-dispatcher.js';

/**
 * Mock request dispatcher.
 *
 * Looks up the interface for method + pathname:
 *  - standard interfaces match their own single method;
 *  - resource collections answer every method on their base path and on
 *    base/:id (the item route).
 * Static (parameterless) paths win over patterns. The matched interface is
 * then routed to either the stateless generator or the stateful collection
 * engine.
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

function staticRank(api) {
  return (api.kind || 'standard') === 'resource'
    ? 0 // resource base/item paths are always static
    : Number(api.path.includes(':'));
}

function matchPath(api, pathname) {
  if ((api.kind || 'standard') === 'resource') {
    const base = api.path.split('/').filter(Boolean);
    const target = pathname.split('/').filter(Boolean);
    if (target.length !== base.length && target.length !== base.length + 1) {
      return null;
    }
    if (!base.every((segment, i) => target[i] === segment)) return null;
    return {
      kind: 'resource',
      segments: target,
      // item = exactly one trailing segment beyond the collection base
      isItem: target.length === base.length + 1,
    };
  }
  if (api.path === pathname) return { kind: 'standard' };
  if (api.path.includes(':') && pathToRegExp(api.path).test(pathname)) {
    return { kind: 'standard' };
  }
  return null;
}

export async function findMatchingInterface(projectId, method, pathname) {
  const apis = await interfaceRepo.listInterfacesForMock(projectId);
  const candidates = apis
    .filter((api) => {
      if ((api.kind || 'standard') === 'resource') return Boolean(matchPath(api, pathname));
      return api.method === method && Boolean(matchPath(api, pathname));
    })
    .sort((a, b) => staticRank(a) - staticRank(b));

  const api = candidates[0];
  if (!api) return null;
  return { api, match: matchPath(api, pathname) };
}

/**
 * Handle an incoming mock request.
 * @returns {{ status: number, body: any, matchedScenario: string|null,
 *             mode: string, headers?: object }}
 */
export async function dispatch(projectId, request) {
  const method = request.method;
  const pathname = request.path;
  const found = await findMatchingInterface(projectId, method, pathname);
  if (!found) {
    return {
      status: 404,
      body: { error: { code: 'MOCK_NOT_FOUND', message: `No mock defined for ${method} ${pathname}` } },
      matchedScenario: null,
      mode: 'none',
    };
  }

  const { api, match } = found;
  if ((api.kind || 'standard') === 'resource') {
    const models = await getModelMap(projectId);
    return dispatchResource(api, match, request, models);
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
    mode: scenario ? 'scenario' : 'standard',
  };
}
