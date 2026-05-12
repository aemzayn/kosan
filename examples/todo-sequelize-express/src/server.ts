import express, { type Request, type Response } from 'express';
import { HeaderResolver, useTenant, getTenantLogContext, getHealthPayload } from '@huni/core';
import { tenantMiddleware } from '@huni/express';
import { registry } from './registry.js';
import usersRouter from './routes/users.js';
import todosRouter from './routes/todos.js';

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Tenant resolution — caller sends X-Tenant: <slug> header.
// Swap this for SubdomainResolver if you prefer acme.yourdomain.com routing.
// ---------------------------------------------------------------------------

app.use(
  tenantMiddleware({
    registry,
    resolver: new HeaderResolver('X-Tenant'),
    onMissingTenant: (_req, res) => {
      res.status(400).json({
        error: 'Missing X-Tenant header. Send the tenant slug with every request.',
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Routes — every handler below can call useTenant() to get the tenant's DB
// ---------------------------------------------------------------------------

app.get('/', (_req: Request, res: Response) => {
  const { tenant } = useTenant();
  res.json({
    tenant: tenant.slug,
    plan: tenant.meta?.['plan'],
    message: `Welcome to the ${tenant.slug} todo app!`,
  });
});

// Users CRUD
app.use('/users', usersRouter);

// Todos CRUD — nested under users
app.use('/users/:userId/todos', todosRouter);

// ---------------------------------------------------------------------------
// Health + observability
// ---------------------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    ...getHealthPayload(registry),
    logContext: getTenantLogContext(),
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
  console.log(`\nTodo API running on http://localhost:${PORT}`);
  console.log('Send X-Tenant: alpha or X-Tenant: beta with every request.\n');
  console.log('Examples:');
  console.log(`  curl -H "X-Tenant: alpha" http://localhost:${PORT}/`);
  console.log(`  curl -H "X-Tenant: alpha" http://localhost:${PORT}/users`);
});
