import { useTenant } from "@kosan/core";
import { type Request, type Response, Router } from "express";
import type { Model, ModelStatic } from "sequelize";

const router = Router({ mergeParams: true });

// All routes are mounted at /users/:userId/todos — scoped to one user.

// GET /users/:userId/todos
router.get("/", async (req: Request, res: Response) => {
  const { models } = useTenant();
  const Todo = models.Todo as ModelStatic<Model>;
  const todos = await Todo.findAll({
    where: { userId: req.params.userId },
    order: [["created_at", "ASC"]],
  });
  res.json(todos);
});

// POST /users/:userId/todos
router.post("/", async (req: Request, res: Response) => {
  const { models } = useTenant();
  const Todo = models.Todo as ModelStatic<Model>;
  try {
    const todo = await Todo.create({
      ...(req.body as Record<string, unknown>),
      userId: req.params.userId,
    });
    res.status(201).json(todo);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// PATCH /users/:userId/todos/:id — toggle completed or update title
router.patch("/:id", async (req: Request, res: Response) => {
  const { models } = useTenant();
  const Todo = models.Todo as ModelStatic<Model>;
  const todo = await Todo.findOne({
    where: { id: req.params.id, userId: req.params.userId },
  });
  if (todo === null) {
    res.status(404).json({ error: "Todo not found" });
    return;
  }
  await todo.update(req.body as Record<string, unknown>);
  res.json(todo);
});

// DELETE /users/:userId/todos/:id
router.delete("/:id", async (req: Request, res: Response) => {
  const { models } = useTenant();
  const Todo = models.Todo as ModelStatic<Model>;
  const deleted = await Todo.destroy({
    where: { id: req.params.id, userId: req.params.userId },
  });
  res.json({ deleted });
});

export default router;
