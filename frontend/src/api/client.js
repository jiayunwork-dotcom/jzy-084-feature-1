/**
 * Thin API client for the management endpoints. Mock endpoints themselves are
 * fetched directly via their /mock/... URLs (see mockClient).
 */

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `请求失败 (${response.status})`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export const api = {
  listModels: () => request('/api/models'),
  createModel: (body) => request('/api/models', { method: 'POST', body }),
  updateModel: (id, body) => request(`/api/models/${id}`, { method: 'PUT', body }),
  deleteModel: (id) => request(`/api/models/${id}`, { method: 'DELETE' }),

  listInterfaces: () => request('/api/interfaces'),
  getInterface: (id) => request(`/api/interfaces/${id}`),
  createInterface: (body) => request('/api/interfaces', { method: 'POST', body }),
  updateInterface: (id, body) => request(`/api/interfaces/${id}`, { method: 'PUT', body }),
  deleteInterface: (id) => request(`/api/interfaces/${id}`, { method: 'DELETE' }),
};

/** Fire a real request at the generated mock endpoint. */
export async function callMock(method, apiPath, { query = '', headers = {}, body } = {}) {
  const url = `/mock${apiPath}${query ? `?${query.replace(/^\?/, '')}` : ''}`;
  const options = {
    method,
    headers: { ...headers },
  };
  if (!['GET', 'HEAD'].includes(method) && body !== undefined && body !== '') {
    options.headers['Content-Type'] = 'application/json';
    options.body = body;
  }
  const startedAt = performance.now();
  const response = await fetch(url, options);
  const elapsed = Math.round(performance.now() - startedAt);
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return {
    status: response.status,
    matchedScenario:
      response.headers.get('x-mock-scenario') === 'default'
        ? null
        : decodeURIComponent(response.headers.get('x-mock-scenario') || 'default'),
    elapsed,
    data: parsed,
  };
}
