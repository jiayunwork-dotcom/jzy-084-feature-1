import { selectScenario } from './scenario-matcher.js';
import { generateNode } from './data-generator.js';
import * as store from './resource-store.js';

/**
 * Dispatch a request that matched a resource-collection interface.
 *
 * Scenario precedence rule (also documented in the README):
 *   Conditional scenarios are evaluated FIRST on every collection request.
 *   A matching scenario wins entirely and returns its generated response
 *   (including its declared status code), exactly as on standard interfaces.
 *   Only when no scenario matches do collection read/write semantics apply.
 *   This keeps the two mechanisms from fighting: scenarios are request-driven
 *   overrides; the collection is the persistent default behaviour.
 *
 * @param {object} api      matched interface (kind === 'resource')
 * @param {{segments:string[]}} match base/item classification from the dispatcher
 * @param {object} request  normalized mock request
 * @param {Map}    models   public model map
 */
export async function dispatchResource(api, match, request, models) {
  const scenario = selectScenario(api.scenarios, request);
  if (scenario) {
    const responseNode = scenario.response;
    const body = generateNode(
      { type: 'object', fields: responseNode.fields || [] },
      models,
    );
    return {
      status: scenario.statusCode && Number.isInteger(scenario.statusCode)
        ? scenario.statusCode
        : 200,
      body,
      matchedScenario: scenario.name,
      mode: 'scenario',
    };
  }

  const method = request.method;
  const isItem = Boolean(match.isItem);
  const recordId = isItem ? decodeURIComponent(request.path.split('/').pop()) : null;

  let result;
  if (!isItem) {
    switch (method) {
      case 'GET':
        result = await store.listCollection(api, request, models);
        break;
      case 'POST':
        result = await store.create(api, request.body, models);
        break;
      default:
        result = store.methodNotAllowedOnCollection();
    }
  } else {
    switch (method) {
      case 'GET':
        result = await store.getOne(api, recordId, models);
        break;
      case 'PUT':
        result = await store.replace(api, recordId, request.body, models);
        break;
      case 'PATCH':
        result = await store.patch(api, recordId, request.body, models);
        break;
      case 'DELETE':
        result = await store.remove(api, recordId, models);
        break;
      default:
        result = store.methodNotAllowedOnItem();
    }
  }

  return finalizeResult(result, api, isItem, recordId);
}

function finalizeResult(result, api, isItem, recordId) {
  const headers = { ...(result.headers || {}) };
  if (result.status === 201 && result.createdId) {
    headers.Location = `${api.path}/${result.createdId}`;
  }
  return {
    status: result.status,
    body: result.body,
    headers,
    matchedScenario: null,
    // 404 here means "matched the resource route but record not found";
    // only 400/405 are method/shape errors rather than resource semantics.
    mode: result.status === 400 || result.status === 405 ? 'resource-error' : 'resource',
    // hint carried for tests/logging, never serialized into the body
    resource: { isItem, recordId: isItem ? recordId : null },
  };
}
