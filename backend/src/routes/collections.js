import { Router } from 'express';
import * as collectionService from '../services/collection-service.js';

export function collectionRoutes() {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      res.json(await collectionService.listCollections(req.projectId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:key/reset', async (req, res, next) => {
    try {
      res.json(await collectionService.resetCollection(req.projectId, req.params.key));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
