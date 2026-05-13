import { Router, type Request, type Response } from 'express';
import { useTenant } from '@kosan/core';
import type { ModelStatic, Model } from 'sequelize';

const router = Router();

// GET /users — list all users for this tenant
router.get('/', async (_req: Request, res: Response) => {
  const { models } = useTenant();
  const User = models['User'] as ModelStatic<Model>;
  const users = await User.findAll({ order: [['created_at', 'ASC']] });
  res.json(users);
});

// GET /users/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { models } = useTenant();
  const User = models['User'] as ModelStatic<Model>;
  const user = await User.findByPk(req.params['id']);
  if (user === null) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

// POST /users — create a user
router.post('/', async (req: Request, res: Response) => {
  const { models } = useTenant();
  const User = models['User'] as ModelStatic<Model>;
  try {
    const user = await User.create(req.body as Record<string, unknown>);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// PATCH /users/:id — update name or email
router.patch('/:id', async (req: Request, res: Response) => {
  const { models } = useTenant();
  const User = models['User'] as ModelStatic<Model>;
  const user = await User.findByPk(req.params['id']);
  if (user === null) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  await user.update(req.body as Record<string, unknown>);
  res.json(user);
});

// DELETE /users/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const { models } = useTenant();
  const User = models['User'] as ModelStatic<Model>;
  const deleted = await User.destroy({ where: { id: req.params['id'] } });
  res.json({ deleted });
});

export default router;
