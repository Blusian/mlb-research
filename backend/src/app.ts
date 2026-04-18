import cors from '@fastify/cors';
import Fastify from 'fastify';

import { registerAnalysisRoutes } from './routes/analysis.js';
import { registerHealthRoutes } from './routes/health.js';

export const buildApp = () => {
  const app = Fastify({
    logger: true,
  });

  void app.register(cors, {
    origin: true,
  });

  void app.register(registerHealthRoutes);
  void app.register(registerAnalysisRoutes);

  return app;
};
