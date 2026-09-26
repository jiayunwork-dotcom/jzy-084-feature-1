/**
 * Conditional scenario matching.
 *
 * A request matches a scenario when ALL of its conditions hold (AND within a
 * scenario). Scenarios are evaluated in declared order and the FIRST match
 * wins (declaration order = priority). If none matches, the default response
 * is used.
 *
 * condition: { location: 'query'|'header'|'body', field, operator, value }
 * supported operators: eq, ne, exists, not_exists, contains
 */

const OPERATORS = {
  eq: (actual, expected) => actual !== undefined && String(actual) === String(expected),
  ne: (actual, expected) => actual === undefined || String(actual) !== String(expected),
  exists: (actual) => actual !== undefined && actual !== '',
  not_exists: (actual) => actual === undefined || actual === '',
  contains: (actual, expected) => actual !== undefined && String(actual).includes(String(expected)),
};

function resolveActual(condition, request) {
  const { location, field } = condition;
  if (location === 'query') return request.query?.[field];
  if (location === 'header') {
    // header names are case insensitive
    return request.header?.(field);
  }
  if (location === 'body') {
    return request.body?.[field];
  }
  return undefined;
}

export function matchCondition(condition, request) {
  const operator = OPERATORS[condition.operator] || OPERATORS.eq;
  return operator(resolveActual(condition, request), condition.value);
}

export function matchScenario(scenario, request) {
  return (scenario.conditions || []).every((condition) => matchCondition(condition, request));
}

/**
 * @returns the first matching scenario, or null when none matches.
 * Scenarios with no conditions are unconditional and match everything.
 */
export function selectScenario(scenarios, request) {
  for (const scenario of scenarios || []) {
    if (matchScenario(scenario, request)) return scenario;
  }
  return null;
}
