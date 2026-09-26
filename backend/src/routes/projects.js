import { Router } from 'express';
import { query } from '../db/pool.js';

export function projectRoutes(defaultProjectId) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT id, name, created_at FROM projects ORDER BY created_at`,
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get('/current', async (req, res) => {
    res.json({ id: defaultProjectId, name: '默认项目' });
  });

  return router;
}
