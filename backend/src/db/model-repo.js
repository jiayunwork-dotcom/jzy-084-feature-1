import { pool } from './pool.js';

export async function listProjects() {
  const { rows } = await pool.query(`SELECT id, name, created_at FROM projects ORDER BY created_at`);
  return rows;
}

export async function listModels(projectId) {
  const { rows } = await pool.query(
    `SELECT id, project_id, name, fields, created_at, updated_at
     FROM models WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
  return rows.map(deserializeModel);
}

export async function getModel(projectId, id) {
  const { rows } = await pool.query(
    `SELECT id, project_id, name, fields, created_at, updated_at
     FROM models WHERE project_id = $1 AND id = $2`,
    [projectId, id],
  );
  return rows[0] ? deserializeModel(rows[0]) : null;
}

export async function createModel(projectId, { name, fields }) {
  const { rows } = await pool.query(
    `INSERT INTO models (project_id, name, fields) VALUES ($1, $2, $3)
     RETURNING id, project_id, name, fields, created_at, updated_at`,
    [projectId, name, JSON.stringify(fields)],
  );
  return deserializeModel(rows[0]);
}

export async function updateModel(projectId, id, { name, fields }) {
  const { rows } = await pool.query(
    `UPDATE models SET name = $3, fields = $4, updated_at = now()
     WHERE project_id = $1 AND id = $2
     RETURNING id, project_id, name, fields, created_at, updated_at`,
    [projectId, id, name, JSON.stringify(fields)],
  );
  return rows[0] ? deserializeModel(rows[0]) : null;
}

export async function deleteModel(projectId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM models WHERE project_id = $1 AND id = $2`,
    [projectId, id],
  );
  return rowCount > 0;
}

function deserializeModel(row) {
  return { ...row, fields: row.fields ?? [] };
}
