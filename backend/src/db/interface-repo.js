import { pool } from './pool.js';

const COLUMNS = `id, project_id, name, path, method, kind, collection, default_response, scenarios, created_at, updated_at`;

export async function listInterfaces(projectId) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
     FROM interfaces WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
  return rows.map(deserializeInterface);
}

export async function getInterface(projectId, id) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
     FROM interfaces WHERE project_id = $1 AND id = $2`,
    [projectId, id],
  );
  return rows[0] ? deserializeInterface(rows[0]) : null;
}

export async function createInterface(projectId, data) {
  const { rows } = await pool.query(
    `INSERT INTO interfaces (project_id, name, path, method, kind, collection, default_response, scenarios)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [
      projectId,
      data.name,
      data.path,
      data.method.toUpperCase(),
      data.kind || 'stateless',
      data.collection ? JSON.stringify(data.collection) : null,
      JSON.stringify(data.defaultResponse),
      JSON.stringify(data.scenarios || []),
    ],
  );
  return deserializeInterface(rows[0]);
}

export async function updateInterface(projectId, id, data) {
  const { rows } = await pool.query(
    `UPDATE interfaces SET name = $3, path = $4, method = $5, kind = $6,
        collection = $7, default_response = $8, scenarios = $9, updated_at = now()
     WHERE project_id = $1 AND id = $2
     RETURNING ${COLUMNS}`,
    [
      projectId,
      id,
      data.name,
      data.path,
      data.method.toUpperCase(),
      data.kind || 'stateless',
      data.collection ? JSON.stringify(data.collection) : null,
      JSON.stringify(data.defaultResponse),
      JSON.stringify(data.scenarios || []),
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
  const { default_response, ...rest } = row;
  return {
    ...rest,
    kind: rest.kind || 'stateless',
    collection: rest.collection ?? null,
    defaultResponse: default_response ?? { fields: [] },
    scenarios: rest.scenarios ?? [],
  };
}
