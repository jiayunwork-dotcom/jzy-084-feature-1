import express from 'express';
import { modelRoutes } from './routes/models.js';
import { interfaceRoutes } from './routes/interfaces.js';
import { projectRoutes } from './routes/projects.js';
import { collectionRoutes } from './routes/collections.js';
import { mockRoutes } from './routes/mock.js';

export function createApp(defaultProjectId) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use((req, res, next) => {
    req.projectId = defaultProjectId;
    next();
  });

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/projects', projectRoutes(defaultProjectId));
  app.use('/api/models', modelRoutes());
  app.use('/api/interfaces', interfaceRoutes());
  app.use('/api/collections', collectionRoutes());
  app.use('/mock', mockRoutes(defaultProjectId));

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `路径不存在：${req.method} ${req.path}` },
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Every structured error exposes `status` + `toJSON()` (duck typing keeps
    // ValidationError/NotFoundError/BadRequestError/ResourceNotFoundError all
    // on the same rendering path).
    if (err && Number.isInteger(err.status) && typeof err.toJSON === 'function') {
      return res.status(err.status).json(err.toJSON());
    }
    console.error(err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
    });
  });

  return app;
}
