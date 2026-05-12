import express, { type Request, type Response } from 'express';
import { SubdomainResolver, useTenant } from '@huni/core';
import { tenantMiddleware } from '@huni/express';
import { registry } from './registry.js';
import type { ModelStatic, Model } from 'sequelize';

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Tenant resolution — acme.localhost:3000, globex.localhost:3000, etc.
// ---------------------------------------------------------------------------

app.use(
  tenantMiddleware({
    registry,
    resolver: new SubdomainResolver(),
    onMissingTenant: (_req, res) => {
      res.status(400).json({
        error: 'No tenant subdomain found. Use <slug>.localhost:3000.',
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Routes — everything below has access to useTenant()
// ---------------------------------------------------------------------------

app.get('/', (_req: Request, res: Response) => {
  const { tenant } = useTenant();
  res.json({
    message: `Hello from tenant "${tenant.slug}"!`,
    plan: tenant.meta?.['plan'],
    dbName: tenant.dbName,
  });
});

app.get('/orders', async (_req: Request, res: Response) => {
  const { models } = useTenant();
  const Order = models['Order'] as ModelStatic<Model>;
  const orders = await Order.findAll();
  res.json(orders);
});

app.post('/orders', async (req: Request, res: Response) => {
  const { models } = useTenant();
  const Order = models['Order'] as ModelStatic<Model>;
  const order = await Order.create(req.body as Record<string, unknown>);
  res.status(201).json(order);
});

app.delete('/orders/:id', async (req: Request, res: Response) => {
  const { models } = useTenant();
  const Order = models['Order'] as ModelStatic<Model>;
  const deleted = await Order.destroy({ where: { id: req.params['id'] } });
  res.json({ deleted });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    cacheSize: registry.cache.size,
    cacheStats: registry.cache.stats(),
  });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: String(err) });
});

const PORT = process.env['PORT'] ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Try: curl -H "Host: acme.localhost" http://localhost:3000/');
});
