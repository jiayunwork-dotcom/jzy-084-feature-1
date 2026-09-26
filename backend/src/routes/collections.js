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

  router.get('/:id', async (req, res, next) => {
    try {
      res.json(await collectionService.getCollection(req.projectId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      res.status(201).json(
        await collectionService.createCollection(req.projectId, req.body),
      );
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      res.json(
        await collectionService.updateCollection(
          req.projectId,
          req.params.id,
          req.body,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      await collectionService.deleteCollection(req.projectId, req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Restore a collection to its initial seed state.
  router.post('/:id/reset', async (req, res, next) => {
    try {
      const data = await collectionService.resetCollection(
        req.projectId,
        req.params.id,
      );
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
