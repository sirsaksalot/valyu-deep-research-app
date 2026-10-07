import { Hono } from "hono";
import { z } from "zod";
import type { Task } from "./types.js";
import { runTask, type WorkerDeps } from "./worker.js";
import { streamSSE } from "hono/streaming";

const DEFAULT_BUDGET_USD = 0.25;

const CreateTaskRequest = z.object({
  prompt: z.string().trim().min(1).max(1000),
});

export function buildApp(deps: WorkerDeps) {
  const { store } = deps;
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({ ok: true });
  });

  app.post("/tasks", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = CreateTaskRequest.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "bad_request",
            message: z.prettifyError(parsed.error),
          },
        },
        400,
      );
    }

    const task: Task = {
      id: crypto.randomUUID(),
      status: "queued",
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      prompt: parsed.data.prompt,
      cost: 0,
      budget: DEFAULT_BUDGET_USD, // min with def budget cap
      events: [],
      report: null,
      sources: [],
    };
    await store.create(task);
    void runTask(task.id, deps).catch((err) => {
      console.error(`task ${task.id} runner failed: `, err);
    });
    return c.json({ task_id: task.id, status: task.status }, 202);
  });

  app.get("/tasks/:id", async (c) => {
    const task = await store.get(c.req.param("id"));
    if (!task) {
      return c.json(
        { error: { code: "task_not_found", message: "task not found" } },
        404,
      );
    }
    return c.json(task);
  });

  app.get("/tasks/:id/events", async (c) => {
    const id = c.req.param("id");
    const task = await store.get(id);
    if (!task) {
      return c.json(
        { error: { code: "task_not_found", message: "task not found" } },
        404,
      );
    }
    return streamSSE(c, async (stream) => {
      let stop = () => {};
      const pingInterval = 15_000;
      const ping = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "" });
      }, pingInterval);

      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
        stop = store.watch(id, async (task) => {
          await stream.writeSSE({ event: "task", data: JSON.stringify(task) });
          if (task.status === "completed" || task.status === "failed") {
            resolve();
          }
        });
      });
      clearInterval(ping);
      stop();
    });
  });

  return app;
}
