import { config } from './config.js';
import { createApp } from './app.js';
import { initSchema, ensureDefaultProject } from './db/schema.js';
import { seedDemoData } from './db/seed.js';
import { pool } from './db/pool.js';
import { listInterfacesForMock } from './db/interface-repo.js';
import { getModelMap } from './services/model-service.js';
import { ensureSeeded } from './mock/resource-store.js';

async function waitForDatabase(retries = 30, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      console.log(`Waiting for PostgreSQL (${attempt}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('PostgreSQL is not reachable');
}

/** Pre-generate the frozen seed of every resource collection at boot. */
async function seedResourceCollections(projectId) {
  const [apis, models] = await Promise.all([
    listInterfacesForMock(projectId),
    getModelMap(projectId),
  ]);
  for (const api of apis) {
    if ((api.kind || 'standard') === 'resource') {
      // eslint-disable-next-line no-await-in-loop
      await ensureSeeded(api, models);
    }
  }
}

async function main() {
  await waitForDatabase();
  await initSchema();
  const projectId = await ensureDefaultProject();
  await seedDemoData(projectId);
  await seedResourceCollections(projectId);

  const app = createApp(projectId);
  app.listen(config.port, () => {
    console.log(`Mock platform backend listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
