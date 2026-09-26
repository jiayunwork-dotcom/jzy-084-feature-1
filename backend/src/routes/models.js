import { Router } from 'express';
import * as modelService from '../services/model-service.js';

export function modelRoutes() {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      res.json(await modelService.listModels(req.projectId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      res.status(201).json(await modelService.createModel(req.projectId, req.body));
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      res.json(await modelService.updateModel(req.projectId, req.params.id, req.body));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      await modelService.deleteModel(req.projectId, req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
