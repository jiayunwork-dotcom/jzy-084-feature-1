import { pool } from './pool.js';

/**
 * Persistence for stateful resource collections.
 *
 * Two tables back this module:
 *  - resource_states: one row per resource interface holding the monotonically
 *    increasing id counter, the initial seed snapshot and seeding bookkeeping;
 *  - resource_records: the live records of the collection.
 *
 * All mutations are single atomic SQL statements (or transactions) so that
 * concurrent writes can never allocate the same id or lose the seeding race.
 */

export async function getState(interfaceId) {
  const { rows } = await pool.query(
    `SELECT initialized, seeding, next_id, seed_snapshot
     FROM resource_states WHERE interface_id = $1`,
    [interfaceId],
  );
  if (rows.length === 0) return null;
  return {
    initialized: rows[0].initialized,
    seeding: rows[0].seeding,
    nextId: Number(rows[0].next_id),
    seedSnapshot: rows[0].seed_snapshot || [],
  };
}

/** Make sure the bookkeeping row exists (idempotent). */
export async function ensureStateRow(interfaceId) {
  await pool.query(
    `INSERT INTO resource_states (interface_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [interfaceId],
  );
}

/**
 * Drop every live record and the bookkeeping row, so the collection is
 * freshly re-seeded from its current definition on its next access.
 */
export async function resetState(interfaceId) {
  await pool.query(`DELETE FROM resource_records WHERE interface_id = $1`, [interfaceId]);
  await pool.query(`DELETE FROM resource_states WHERE interface_id = $1`, [interfaceId]);
}

/**
 * Atomically claim the right to seed this collection.
 * Exactly one concurrent caller gets true; everyone else waits.
 */
export async function tryStartSeeding(interfaceId) {
  await ensureStateRow(interfaceId);
  const { rowCount } = await pool.query(
    `UPDATE resource_states SET seeding = true
     WHERE interface_id = $1 AND seeding = false AND initialized = false`,
    [interfaceId],
  );
  return rowCount > 0;
}

/** Release a claimed seeding lock when seeding failed so a retry can happen. */
export async function markSeedingFailed(interfaceId) {
  await pool.query(
    `UPDATE resource_states SET seeding = false
     WHERE interface_id = $1 AND initialized = false`,
    [interfaceId],
  );
}

/**
 * Commit the initial seed atomically: insert every record, then publish the
 * snapshot/counter and flip initialized on. @param {Array<{recordId:string, seq:number, data:object}>} records
 */
export async function commitSeed(interfaceId, records) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertRecords(client, interfaceId, records);
    await client.query(
      `UPDATE resource_states
       SET initialized = true, seeding = false,
           next_id = $2::bigint, seed_snapshot = $3::jsonb
       WHERE interface_id = $1`,
      [interfaceId, records.length + 1, JSON.stringify(records)],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Atomically allocate the next stable id (gap-free, repeat-safe). */
export async function allocateId(interfaceId) {
  const { rows } = await pool.query(
    `UPDATE resource_states SET next_id = next_id + 1
     WHERE interface_id = $1
     RETURNING next_id - 1 AS allocated`,
    [interfaceId],
  );
  if (rows.length === 0) {
    // State row somehow missing: create it, then allocate starting at 1.
    await ensureStateRow(interfaceId);
    const retry = await pool.query(
      `UPDATE resource_states SET next_id = next_id + 1
       WHERE interface_id = $1
       RETURNING next_id - 1 AS allocated`,
      [interfaceId],
    );
    return Number(retry.rows[0].allocated);
  }
  return Number(rows[0].allocated);
}

export async function insertRecord(interfaceId, record) {
  await pool.query(
    `INSERT INTO resource_records (interface_id, record_id, seq, data)
     VALUES ($1, $2, $3::bigint, $4::jsonb)`,
    [interfaceId, record.recordId, String(record.seq), JSON.stringify(record.data)],
  );
}

export async function countRecords(interfaceId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM resource_records WHERE interface_id = $1`,
    [interfaceId],
  );
  return rows[0].total;
}

/**
 * List records in stable insertion order.
 * @param {{ equal?: object }} filters exact-match filters on top-level fields
 */
export async function listRecords(interfaceId, { limit, offset, equal = {} } = {}) {
  const entries = Object.entries(equal);
  const clauses = entries.map((_, i) => `data ->> $${i + 2} = $${i + 3}`);
  const where = ['interface_id = $1', ...clauses].join(' AND ');
  const params = [interfaceId];
  for (const [key, value] of entries) {
    params.push(key, String(value));
  }
  const countSql = `SELECT count(*)::int AS total FROM resource_records WHERE ${where}`;
  const total = (await pool.query(countSql, params)).rows[0].total;

  const dataSql = `SELECT record_id, seq, data FROM resource_records
    WHERE ${where} ORDER BY seq ASC LIMIT ${Math.max(1, limit)} OFFSET ${Math.max(0, offset)}`;
  const { rows } = await pool.query(dataSql, params);
  return {
    total,
    records: rows.map((row) => ({
      recordId: row.record_id,
      seq: Number(row.seq),
      data: row.data,
    })),
  };
}

export async function getRecord(interfaceId, recordId) {
  const { rows } = await pool.query(
    `SELECT record_id, seq, data FROM resource_records
     WHERE interface_id = $1 AND record_id = $2`,
    [interfaceId, String(recordId)],
  );
  if (rows.length === 0) return null;
  return { recordId: rows[0].record_id, seq: Number(rows[0].seq), data: rows[0].data };
}

export async function updateRecordData(interfaceId, recordId, data) {
  const { rows } = await pool.query(
    `UPDATE resource_records SET data = $3::jsonb
     WHERE interface_id = $1 AND record_id = $2
     RETURNING record_id, seq, data`,
    [interfaceId, String(recordId), JSON.stringify(data)],
  );
  if (rows.length === 0) return null;
  return { recordId: rows[0].record_id, seq: Number(rows[0].seq), data: rows[0].data };
}

export async function deleteRecord(interfaceId, recordId) {
  const { rowCount } = await pool.query(
    `DELETE FROM resource_records WHERE interface_id = $1 AND record_id = $2`,
    [interfaceId, String(recordId)],
  );
  return rowCount > 0;
}

/**
 * Restore a collection to its stored seed snapshot inside one transaction.
 * The counter is rewound to snapshot.length + 1, so post-reset creates
 * continue exactly where the seed left off.
 */
export async function resetToSnapshot(interfaceId) {
  const state = await getState(interfaceId);
  if (!state || !state.initialized) return null;
  const snapshot = state.seedSnapshot;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM resource_records WHERE interface_id = $1`,
      [interfaceId],
    );
    await insertRecords(client, interfaceId, snapshot);
    await client.query(
      `UPDATE resource_states
       SET initialized = true, seeding = false, next_id = $2::bigint
       WHERE interface_id = $1`,
      [interfaceId, String(snapshot.length + 1)],
    );
    await client.query('COMMIT');
    return snapshot;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function insertRecords(client, interfaceId, records) {
  if (records.length === 0) return Promise.resolve();
  const valueClauses = [];
  const params = [interfaceId];
  let placeholder = 2;
  for (const record of records) {
    valueClauses.push(`($1, $${placeholder}, $${placeholder + 1}::bigint, $${placeholder + 2}::jsonb)`);
    params.push(record.recordId, String(record.seq), JSON.stringify(record.data));
    placeholder += 3;
  }
  return client.query(
    `INSERT INTO resource_records (interface_id, record_id, seq, data) VALUES ${valueClauses.join(', ')}`,
    params,
  );
}
