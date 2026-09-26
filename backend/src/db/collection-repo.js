import { pool } from './pool.js';

/**
 * Persistence for stateful resource collections and their records.
 *
 * All read/write functions accept an optional executor (a pg client within a
 * transaction); they fall back to the shared pool. The collection service
 * serializes every mutating sequence (allocate id -> write -> persist counter)
 * inside one transaction.
 */

/** Run a unit of work inside a transaction with a dedicated client. */
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function deserializeCollection(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    basePath: row.base_path,
    recordSchema: row.record_schema,
    seedCount: row.seed_count,
    seedRecords: row.seed_records ?? [],
    nextId: Number(row.next_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `id, project_id, name, base_path, record_schema,
  seed_count, seed_records, next_id, created_at, updated_at`;

export async function listCollections(projectId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ${SELECT_COLUMNS} FROM collections
     WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
  return rows.map(deserializeCollection);
}

export async function getCollection(projectId, id, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ${SELECT_COLUMNS} FROM collections
     WHERE project_id = $1 AND id = $2`,
    [projectId, id],
  );
  return deserializeCollection(rows[0]);
}

/** Get a collection without project scoping (used on the mock request path). */
export async function getCollectionById(id, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ${SELECT_COLUMNS} FROM collections WHERE id = $1`,
    [id],
  );
  return deserializeCollection(rows[0]);
}

/** Find the collection (if any) whose base path the request path sits under. */
export async function findCollectionForPath(projectId, pathname, executor = pool) {
  // Collections per project are few; longest-prefix matching is done in JS
  // to keep the SQL portable (no length()/LIKE-concat dependencies).
  const { rows } = await executor.query(
    `SELECT ${SELECT_COLUMNS} FROM collections WHERE project_id = $1`,
    [projectId],
  );
  const candidates = rows
    .map(deserializeCollection)
    .filter((c) => pathname === c.basePath || pathname.startsWith(`${c.basePath}/`))
    .sort((a, b) => b.basePath.length - a.basePath.length);
  return candidates[0] || null;
}

export async function createCollection(projectId, data, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO collections
       (project_id, name, base_path, record_schema, seed_count, seed_records, next_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${SELECT_COLUMNS}`,
    [
      projectId,
      data.name,
      data.basePath,
      JSON.stringify(data.recordSchema),
      data.seedCount,
      JSON.stringify(data.seedRecords || []),
      data.nextId ?? 1,
    ],
  );
  return deserializeCollection(rows[0]);
}

export async function updateCollectionDefinition(projectId, id, data, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE collections SET
       name = $3, base_path = $4, record_schema = $5, seed_count = $6,
       seed_records = $7, next_id = $8, updated_at = now()
     WHERE project_id = $1 AND id = $2
     RETURNING ${SELECT_COLUMNS}`,
    [
      projectId,
      id,
      data.name,
      data.basePath,
      JSON.stringify(data.recordSchema),
      data.seedCount,
      JSON.stringify(data.seedRecords || []),
      data.nextId ?? 1,
    ],
  );
  return deserializeCollection(rows[0]);
}

export async function deleteCollection(projectId, id, executor = pool) {
  const { rowCount } = await executor.query(
    `DELETE FROM collections WHERE project_id = $1 AND id = $2`,
    [projectId, id],
  );
  return rowCount > 0;
}

/**
 * Capture the initial seed snapshot (and the resulting id counter) on the
 * collection row after records have been seeded. Used by "reset".
 */
export async function persistSeedSnapshot(
  collectionId,
  seedRecords,
  nextId,
  executor = pool,
) {
  const { rows } = await executor.query(
    `UPDATE collections SET seed_records = $2, next_id = $3, updated_at = now()
     WHERE id = $1
     RETURNING ${SELECT_COLUMNS}`,
    [collectionId, JSON.stringify(seedRecords), String(nextId)],
  );
  return deserializeCollection(rows[0]);
}

// ---------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------

export async function listRecords(collectionId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT record_id, data FROM collection_records
     WHERE collection_id = $1 ORDER BY record_id ASC`,
    [collectionId],
  );
  return rows.map((row) => ({ id: Number(row.record_id), data: row.data }));
}

export async function getRecord(collectionId, recordId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT data FROM collection_records
     WHERE collection_id = $1 AND record_id = $2`,
    [collectionId, String(recordId)],
  );
  return rows[0] ? rows[0].data : null;
}

/**
 * Insert one record and advance the id counter atomically with the caller's
 * already-reserved id. Caller (store) owns id allocation within a mutex +
 * transaction, so no duplicate (collection_id, record_id) can be committed.
 */
export async function insertRecord(collectionId, recordId, data, executor = pool) {
  await executor.query(
    `INSERT INTO collection_records (collection_id, record_id, data)
     VALUES ($1, $2, $3)`,
    [collectionId, String(recordId), JSON.stringify(data)],
  );
}

export async function updateRecordData(collectionId, recordId, data, executor = pool) {
  const { rowCount } = await executor.query(
    `UPDATE collection_records SET data = $3, updated_at = now()
     WHERE collection_id = $1 AND record_id = $2`,
    [collectionId, String(recordId), JSON.stringify(data)],
  );
  return rowCount > 0;
}

export async function deleteRecord(collectionId, recordId, executor = pool) {
  const { rowCount } = await executor.query(
    `DELETE FROM collection_records WHERE collection_id = $1 AND record_id = $2`,
    [collectionId, String(recordId)],
  );
  return rowCount > 0;
}

/** Atomically reserve the next stable id for a collection. */
export async function reserveNextId(collectionId, currentNextId, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE collections SET next_id = $3, updated_at = now()
     WHERE id = $1 AND next_id = $2
     RETURNING next_id`,
    [collectionId, String(currentNextId), String(currentNextId + 1)],
  );
  if (rows.length === 0) {
    throw new Error('id counter was modified concurrently');
  }
  return currentNextId;
}

/** Replace the whole record set and counter in one go (seed/reset/edit). */
export async function replaceAllRecords(
  collectionId,
  records,
  nextId,
  executor = pool,
) {
  await executor.query(
    `DELETE FROM collection_records WHERE collection_id = $1`,
    [collectionId],
  );
  for (const record of records) {
    await executor.query(
      `INSERT INTO collection_records (collection_id, record_id, data)
       VALUES ($1, $2, $3)`,
      [collectionId, String(record.id), JSON.stringify(record.data)],
    );
  }
  await executor.query(
    `UPDATE collections SET next_id = $2, updated_at = now() WHERE id = $1`,
    [collectionId, String(nextId)],
  );
}
