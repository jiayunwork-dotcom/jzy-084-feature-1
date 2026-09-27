import { pool } from './pool.js';

/**
 * Persistence for stateful resource collections.
 *
 * One `collection_states` row per (project, collectionKey) holds the seed
 * snapshot and the monotonically increasing `next_seq` identifier counter;
 * `collection_records` holds the live records. Interfaces that declare the
 * same collectionKey share one state.
 *
 * Concurrency: identifier allocation is a single atomic
 * `UPDATE ... SET next_seq = next_seq + 1 ... RETURNING` statement, so
 * concurrent writers can never receive duplicate identifiers. Seeding is
 * claimed by a conditional UPDATE inside a transaction — exactly one caller
 * wins the claim and inserts the seed records.
 */

function deserializeState(row) {
  return {
    projectId: row.project_id,
    collectionKey: row.collection_key,
    recordSchema: row.record_schema,
    idField: row.id_field,
    seedCount: Number(row.seed_count),
    nextSeq: Number(row.next_seq),
    seedSnapshot: row.seed_snapshot ?? null,
    seededAt: row.seeded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deserializeRecord(row) {
  return { key: row.record_key, seq: Number(row.seq), data: row.data };
}

export async function getState(projectId, key) {
  const { rows } = await pool.query(
    `SELECT project_id, collection_key, record_schema, id_field, seed_count,
            next_seq, seed_snapshot, seeded_at, created_at, updated_at
     FROM collection_states
     WHERE project_id = $1 AND collection_key = $2`,
    [projectId, key],
  );
  return rows[0] ? deserializeState(rows[0]) : null;
}

/**
 * Ensure the collection state row exists and is seeded. `seedFactory()` is
 * called at most once per collection (lazily, on first access) and must
 * return `{ records: [{ seq, key, data }], nextSeq }`.
 */
export async function ensureSeeded(projectId, key, config, seedFactory) {
  await pool.query(
    `INSERT INTO collection_states (project_id, collection_key, record_schema, id_field, seed_count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, collection_key) DO NOTHING`,
    [projectId, key, JSON.stringify(config.record), config.idField, config.seedCount],
  );
  const existing = await getState(projectId, key);
  if (existing.seedSnapshot) return existing;

  const snapshot = seedFactory();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The conditional UPDATE doubles as the seeding claim: only the caller
    // that still finds seed_snapshot NULL wins; concurrent claimants block
    // on the row lock until the winner commits, then see it already set.
    const claim = await client.query(
      `UPDATE collection_states
       SET seed_snapshot = $3, next_seq = $4, seeded_at = now(), updated_at = now()
       WHERE project_id = $1 AND collection_key = $2 AND seed_snapshot IS NULL
       RETURNING project_id`,
      [projectId, key, JSON.stringify(snapshot), snapshot.nextSeq],
    );
    if (claim.rows.length > 0) {
      for (const record of snapshot.records) {
        await client.query(
          `INSERT INTO collection_records (project_id, collection_key, record_key, seq, data)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id, collection_key, record_key) DO NOTHING`,
          [projectId, key, record.key, record.seq, JSON.stringify(record.data)],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getState(projectId, key);
}

/** All live records of a collection, in stable insertion order. */
export async function listRecords(projectId, key) {
  const { rows } = await pool.query(
    `SELECT record_key, seq, data FROM collection_records
     WHERE project_id = $1 AND collection_key = $2
     ORDER BY seq ASC`,
    [projectId, key],
  );
  return rows.map(deserializeRecord);
}

export async function getRecord(projectId, key, recordKey) {
  const { rows } = await pool.query(
    `SELECT record_key, seq, data FROM collection_records
     WHERE project_id = $1 AND collection_key = $2 AND record_key = $3`,
    [projectId, key, recordKey],
  );
  return rows[0] ? deserializeRecord(rows[0]) : null;
}

/**
 * Allocate the next identifier. This single UPDATE is the serialization
 * point that guarantees unique, never-reused ids under concurrent writes.
 */
export async function allocateSeq(projectId, key) {
  const { rows } = await pool.query(
    `UPDATE collection_states SET next_seq = next_seq + 1, updated_at = now()
     WHERE project_id = $1 AND collection_key = $2
     RETURNING next_seq`,
    [projectId, key],
  );
  if (rows.length === 0) throw new Error(`Collection state missing: ${key}`);
  return Number(rows[0].next_seq) - 1;
}

export async function insertRecord(projectId, key, record) {
  await pool.query(
    `INSERT INTO collection_records (project_id, collection_key, record_key, seq, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [projectId, key, record.key, record.seq, JSON.stringify(record.data)],
  );
  return record;
}

export async function updateRecord(projectId, key, recordKey, data) {
  const { rows } = await pool.query(
    `UPDATE collection_records SET data = $4, updated_at = now()
     WHERE project_id = $1 AND collection_key = $2 AND record_key = $3
     RETURNING record_key, seq, data`,
    [projectId, key, recordKey, JSON.stringify(data)],
  );
  return rows[0] ? deserializeRecord(rows[0]) : null;
}

export async function deleteRecord(projectId, key, recordKey) {
  const { rows } = await pool.query(
    `DELETE FROM collection_records
     WHERE project_id = $1 AND collection_key = $2 AND record_key = $3
     RETURNING record_key, seq, data`,
    [projectId, key, recordKey],
  );
  return rows[0] ? deserializeRecord(rows[0]) : null;
}

/**
 * Restore the collection to its initial seed snapshot: live records are
 * replaced by the snapshot and the id counter rewinds to its post-seed
 * value, exactly as if the collection had never been touched.
 */
export async function resetToSeed(projectId, key) {
  const state = await getState(projectId, key);
  if (!state || !state.seedSnapshot) return null;
  const snapshot = state.seedSnapshot;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM collection_records WHERE project_id = $1 AND collection_key = $2`,
      [projectId, key],
    );
    for (const record of snapshot.records) {
      await client.query(
        `INSERT INTO collection_records (project_id, collection_key, record_key, seq, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [projectId, key, record.key, record.seq, JSON.stringify(record.data)],
      );
    }
    await client.query(
      `UPDATE collection_states SET next_seq = $3, updated_at = now()
       WHERE project_id = $1 AND collection_key = $2`,
      [projectId, key, snapshot.nextSeq],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getState(projectId, key);
}

/** Overview of every seeded collection of a project (for the console UI). */
export async function listCollectionStates(projectId) {
  const [states, counts] = await Promise.all([
    pool.query(
      `SELECT project_id, collection_key, record_schema, id_field, seed_count,
              next_seq, seeded_at, created_at, updated_at
       FROM collection_states
       WHERE project_id = $1
       ORDER BY collection_key`,
      [projectId],
    ),
    pool.query(
      `SELECT collection_key, count(*) AS record_count
       FROM collection_records
       WHERE project_id = $1
       GROUP BY collection_key`,
      [projectId],
    ),
  ]);
  const countByKey = new Map(
    counts.rows.map((row) => [row.collection_key, Number(row.record_count)]),
  );
  return states.rows.map((row) => ({
    ...deserializeState(row),
    seedSnapshot: undefined, // not needed by the console; keep payload small
    recordCount: countByKey.get(row.collection_key) ?? 0,
  }));
}
