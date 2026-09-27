import { pool } from './pool.js';

/** Add a column to an existing table unless it is already there (upgrade path). */
async function ensureColumn(table, column, ddl) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  if (rows.length === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

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
      kind              TEXT NOT NULL DEFAULT 'stateless',
      collection        JSONB,
      default_response  JSONB NOT NULL,
      scenarios         JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, path, method)
    );

    -- Stateful resource collections. One state row per (project, collectionKey);
    -- interfaces sharing a collectionKey operate on the same state.
    CREATE TABLE IF NOT EXISTS collection_states (
      project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      collection_key  TEXT NOT NULL,
      record_schema   JSONB NOT NULL,
      id_field        TEXT NOT NULL DEFAULT 'id',
      seed_count      INTEGER NOT NULL DEFAULT 5,
      next_seq        BIGINT NOT NULL DEFAULT 1,
      seed_snapshot   JSONB,
      seeded_at       TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, collection_key)
    );

    CREATE TABLE IF NOT EXISTS collection_records (
      project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      collection_key  TEXT NOT NULL,
      record_key      TEXT NOT NULL,
      seq             BIGINT NOT NULL,
      data            JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, collection_key, record_key)
    );
  `);

  // Upgrade path for databases created before interfaces had a kind/collection.
  await ensureColumn('interfaces', 'kind', `kind TEXT NOT NULL DEFAULT 'stateless'`);
  await ensureColumn('interfaces', 'collection', `collection JSONB`);
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
