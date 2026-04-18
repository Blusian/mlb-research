import type { FastifyPluginAsync } from 'fastify';

export const registerHealthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/health', async () => ({
    ok: true,
    service: 'mlb-daily-matchup-analyzer-api',
    timestamp: new Date().toISOString(),
  }));
};
