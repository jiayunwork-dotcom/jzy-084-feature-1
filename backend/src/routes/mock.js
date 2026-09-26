import { Router } from 'express';
import { dispatch } from '../mock/dispatcher.js';

/**
 * Mock endpoints are served under /mock/* so they never collide with the
 * management API. Any method/path is accepted and matched dynamically.
 */
export function mockRoutes(defaultProjectId) {
  const router = Router();

  router.all('/*', async (req, res, next) => {
    try {
      const request = {
        method: req.method,
        // strip the "/mock" mount prefix; req.url is relative to the mount
        path: req.url.split('?')[0],
        query: req.query,
        header: (name) => req.header(name),
        body: req.body,
      };
      const result = await dispatch(defaultProjectId, request);
      // Header values must be ASCII; percent-encode (possibly Chinese) names.
      res.setHeader(
        'X-Mock-Scenario',
        result.matchedScenario ? encodeURIComponent(result.matchedScenario) : 'default',
      );
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
