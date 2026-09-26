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

    -- kind: 'standard'（普通接口，每次现生成）或 'resource'（有状态资源集合）
    ALTER TABLE interfaces
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard';

    -- 资源集合配置：{ fields, seedCount, idField, pageSize }
    -- 仅 kind = 'resource' 时非空
    ALTER TABLE interfaces
      ADD COLUMN IF NOT EXISTS resource_config JSONB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resource_states (
      interface_id  UUID PRIMARY KEY REFERENCES interfaces(id) ON DELETE CASCADE,
      initialized   BOOLEAN NOT NULL DEFAULT false,
      seeding       BOOLEAN NOT NULL DEFAULT false,
      next_id       BIGINT NOT NULL DEFAULT 1,
      seed_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
    );

    CREATE TABLE IF NOT EXISTS resource_records (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interface_id  UUID NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
      record_id     TEXT NOT NULL,
      seq           BIGINT NOT NULL,
      data          JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (interface_id, record_id)
    );

    CREATE INDEX IF NOT EXISTS resource_records_interface_seq_idx
      ON resource_records (interface_id, seq);
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
