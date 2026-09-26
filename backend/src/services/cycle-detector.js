/**
 * Circular reference detection for public models.
 *
 * Models form a directed graph: an edge A -> B exists when model A
 * (directly, through nested objects, or through array items) references
 * model B. A self reference A -> A is a cycle of length 1.
 *
 * findCycles() runs Tarjan's strongly connected components algorithm and
 * reports every SCC that contains a cycle, with a concrete edge path so the
 * error message can name the models involved.
 */

/** Collect every model id referenced by a schema node tree. */
export function collectRefs(node, acc = new Set()) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, acc);
    return acc;
  }
  if (node.type === 'ref' && node.ref) acc.add(node.ref);
  if (node.type === 'array' && node.items) collectRefs(node.items, acc);
  if (node.type === 'object' && Array.isArray(node.fields)) {
    for (const field of node.fields) collectRefs(field, acc);
  }
  return acc;
}

function buildGraph(models) {
  const graph = new Map();
  for (const model of models.values()) {
    graph.set(model.id, [...collectRefs({ type: 'object', fields: model.fields })]);
  }
  return graph;
}

/**
 * @param {Map<string,{id:string,name:string,fields:Array}>} models
 * @returns {Array<Array<string>>} cycles as lists of model ids; for an SCC
 *   with more than one node the last id points back to the first.
 */
export function findCycles(models) {
  const graph = buildGraph(models);
  let indexCounter = 0;
  const indices = new Map();
  const lowlink = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];

  function strongConnect(v) {
    indices.set(v, indexCounter);
    lowlink.set(v, indexCounter);
    indexCounter += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) || []) {
      if (!graph.has(w)) continue; // dangling refs reported elsewhere
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== v);

      if (component.length > 1) {
        cycles.push(orderCycle(component, graph));
      } else {
        // SCC of one node cycles only through a self edge
        const [node] = component;
        if ((graph.get(node) || []).includes(node)) cycles.push([node]);
      }
    }
  }

  for (const v of graph.keys()) {
    if (!indices.has(v)) strongConnect(v);
  }

  return cycles;
}

/**
 * Turn an unordered SCC into a readable cycle path by following graph edges
 * that stay inside the component.
 */
function orderCycle(component, graph) {
  const members = new Set(component);
  const start = component[0];
  const path = [start];
  let current = start;
  const guard = component.length + 1;

  for (let i = 0; i < guard; i += 1) {
    const next = (graph.get(current) || []).find(
      (id) => members.has(id) && (id === start || !path.includes(id)),
    );
    if (!next || next === start) {
      if (next === start) path.push(start);
      return path;
    }
    path.push(next);
    current = next;
  }
  return path;
}

/**
 * Convenience wrapper returning cycles annotated with model display names.
 * @returns {Array<{ids:string[], names:string[]}>}
 */
export function findNamedCycles(models) {
  return findCycles(models).map((ids) => ({
    ids,
    names: ids.map((id) => models.get(id)?.name || id),
  }));
}
