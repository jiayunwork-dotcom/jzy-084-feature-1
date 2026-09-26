import { pool } from './pool.js';

const SELECT_COLUMNS =
  'id, project_id, name, path, method, default_response, scenarios, kind, resource_config, created_at, updated_at';

export async function listInterfaces(projectId) {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM interfaces WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
  return rows.map(deserializeInterface);
}

export async function getInterface(projectId, id) {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM interfaces WHERE project_id = $1 AND id = $2`,
    [projectId, id],
  );
  return rows[0] ? deserializeInterface(rows[0]) : null;
}

export async function createInterface(projectId, data) {
  const { rows } = await pool.query(
    `INSERT INTO interfaces (project_id, name, path, method, default_response, scenarios, kind, resource_config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SELECT_COLUMNS}`,
    [
      projectId,
      data.name,
      data.path,
      data.method.toUpperCase(),
      JSON.stringify(data.defaultResponse),
      JSON.stringify(data.scenarios || []),
      data.kind || 'standard',
      data.resourceConfig ? JSON.stringify(data.resourceConfig) : null,
    ],
  );
  return deserializeInterface(rows[0]);
}

export async function updateInterface(projectId, id, data) {
  const { rows } = await pool.query(
    `UPDATE interfaces SET name = $3, path = $4, method = $5,
        default_response = $6, scenarios = $7, kind = $8, resource_config = $9, updated_at = now()
     WHERE project_id = $1 AND id = $2
     RETURNING ${SELECT_COLUMNS}`,
    [
      projectId,
      id,
      data.name,
      data.path,
      data.method.toUpperCase(),
      JSON.stringify(data.defaultResponse),
      JSON.stringify(data.scenarios || []),
      data.kind || 'standard',
      data.resourceConfig ? JSON.stringify(data.resourceConfig) : null,
    ],
  );
  return rows[0] ? deserializeInterface(rows[0]) : null;
}

export async function deleteInterface(projectId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM interfaces WHERE project_id = $1 AND id = $2`,
    [projectId, id],
  );
  return rowCount > 0;
}

/** All interfaces of a project — used by the mock dispatcher. */
export async function listInterfacesForMock(projectId) {
  return listInterfaces(projectId);
}

function deserializeInterface(row) {
  const { default_response, resource_config, ...rest } = row;
  return {
    ...rest,
    kind: rest.kind || 'standard',
    defaultResponse: default_response ?? { fields: [] },
    scenarios: rest.scenarios ?? [],
    resourceConfig: resource_config ?? null,
  };
}
