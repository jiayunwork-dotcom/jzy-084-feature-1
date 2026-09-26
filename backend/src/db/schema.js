import { pool } from './pool.js';

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS models (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      fields      JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, name)
    );

    CREATE TABLE IF NOT EXISTS interfaces (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      path              TEXT NOT NULL,
      method            TEXT NOT NULL,
      default_response  JSONB NOT NULL,
      scenarios         JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, path, method)
    );
  `);
}

/** Ensure the default project exists; returns its id. */
export async function ensureDefaultProject() {
  const { rows } = await pool.query(
    `INSERT INTO projects (name) VALUES ('默认项目')
     ON CONFLICT DO NOTHING
     RETURNING id`,
  );
  if (rows.length > 0) return rows[0].id;
  const existing = await pool.query(`SELECT id FROM projects ORDER BY created_at LIMIT 1`);
  return existing.rows[0].id;
}
