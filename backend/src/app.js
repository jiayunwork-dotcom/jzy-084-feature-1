import express from 'express';
import { ValidationError, NotFoundError } from './errors.js';
import { modelRoutes } from './routes/models.js';
import { interfaceRoutes } from './routes/interfaces.js';
import { projectRoutes } from './routes/projects.js';
import { mockRoutes } from './routes/mock.js';

export function createApp(defaultProjectId) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Malformed JSON bodies are a client error, not an internal error.
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST_BODY',
          message: `请求体不是合法的 JSON：${err.message}`,
        },
      });
    }
    return next(err);
  });

  app.use((req, res, next) => {
    req.projectId = defaultProjectId;
    next();
  });

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/projects', projectRoutes(defaultProjectId));
  app.use('/api/models', modelRoutes());
  app.use('/api/interfaces', interfaceRoutes());
  app.use('/mock', mockRoutes(defaultProjectId));

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `路径不存在：${req.method} ${req.path}` },
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError || err instanceof NotFoundError) {
      return res.status(err.status).json(err.toJSON());
    }
    console.error(err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
    });
  });

  return app;
}
