import { Router } from 'express';
import * as interfaceService from '../services/interface-service.js';
import * as modelService from '../services/model-service.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { resetCollection, getCollectionStatus } from '../mock/resource-store.js';

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

  // ---- stateful resource collection: live state + reset --------------------

  router.get('/:id/resource-state', async (req, res, next) => {
    try {
      const api = await interfaceService.getInterface(req.projectId, req.params.id);
      if ((api.kind || 'standard') !== 'resource') {
        throw new ValidationError('该接口不是资源集合', [
          { path: 'kind', message: '仅资源集合形态的接口拥有可查询的集合状态' },
        ]);
      }
      const models = await modelService.getModelMap(req.projectId);
      res.json(await getCollectionStatus(api, models));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/resource-reset', async (req, res, next) => {
    try {
      const api = await interfaceService.getInterface(req.projectId, req.params.id);
      if ((api.kind || 'standard') !== 'resource') {
        throw new NotFoundError('资源集合不存在');
      }
      const models = await modelService.getModelMap(req.projectId);
      const data = await resetCollection(api, models);
      res.json({ reset: true, total: data.length, data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
