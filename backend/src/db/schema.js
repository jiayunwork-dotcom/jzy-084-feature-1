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

    -- 资源集合：一种有状态的接口形态。seed_records 保存最初种入的记录快照，
    -- 供「恢复初始状态」原样回放；next_id 是单调递增的记录标识分配器。
    CREATE TABLE IF NOT EXISTS collections (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      base_path     TEXT NOT NULL,
      record_schema JSONB NOT NULL,
      seed_count    INTEGER NOT NULL DEFAULT 5,
      seed_records  JSONB NOT NULL DEFAULT '[]'::jsonb,
      next_id       BIGINT NOT NULL DEFAULT 1,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, base_path)
    );

    -- 集合当前持有的记录。标识一经分配直到删除保持稳定（不复用）。
    CREATE TABLE IF NOT EXISTS collection_records (
      collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      record_id     BIGINT NOT NULL,
      data          JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_id, record_id)
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
