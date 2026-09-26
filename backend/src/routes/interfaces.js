import { Router } from 'express';
import * as interfaceService from '../services/interface-service.js';

export function interfaceRoutes() {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      res.json(await interfaceService.listInterfaces(req.projectId));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      res.json(await interfaceService.getInterface(req.projectId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      res.status(201).json(await interfaceService.createInterface(req.projectId, req.body));
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      res.json(
        await interfaceService.updateInterface(req.params.id, req.projectId, req.body),
      );
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      await interfaceService.deleteInterface(req.projectId, req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
