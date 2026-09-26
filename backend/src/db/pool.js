import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unexpected idle PostgreSQL client error', err);
});

export async function query(text, params) {
  return pool.query(text, params);
}
