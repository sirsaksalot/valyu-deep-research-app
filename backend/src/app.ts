import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { IS_TERMINAL, newTask } from "./types.js";
import type { Dispatch } from "./queue.js";
import { runTask, type WorkerDeps } from "./worker.js";

export type AppDeps = WorkerDeps & {
  dispatch: Dispatch;
  verifyWorker?: (authorization: string | undefined) => Promise<boolean>; // cloud tasks
};

const ACCESS_CODE = process.env.ACCESS_CODE;
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? "*").split(",");

const CreateTaskRequest = z.object({
  prompt: z.string().trim().min(1).max(1000),
});

const MessageRequest = z.object({
  text: z.string().trim().min(1).max(1000),
});

const apiError = (
  c: Context,
  status: 400 | 401 | 404 | 409 | 503,
  code: string,
  message: string,
) => c.json({ error: { code, message } }, status);

// ?code= for EventSource (no headers)
const requireCode = createMiddleware(async (c, next) => {
  if (!ACCESS_CODE) return next();
  const code =
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
    c.req.query("code");
  if (code !== ACCESS_CODE) {
    return apiError(c, 401, "unauthorized", "access code missing or wrong");
  }
  await next();
});

export function buildApp(deps: AppDeps) {
  const { store, dispatch, verifyWorker } = deps;
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: CORS_ORIGINS.includes("*") ? "*" : CORS_ORIGINS,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.get("/health", (c) => {
    return c.json({ ok: true });
  });

  app.get("/access", requireCode, (c) => c.body(null, 204));

  app.get("/tasks", requireCode, async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 100);
    return c.json({ tasks: await store.list(limit) });
  });

  app.post("/tasks", requireCode, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = CreateTaskRequest.safeParse(raw);
    if (!parsed.success) {
      return apiError(c, 400, "bad_request", z.prettifyError(parsed.error));
    }
    const task = newTask(parsed.data.prompt);
    await store.create(task);
    try {
      await dispatch(task.id);
    } catch (err) {
      console.error(`task ${task.id}: dispatch failed`, err);
      await store.update(task.id, {
        status: "failed",
        error: { code: "dispatch_failed", message: "could not queue the task" },
        finishedAt: new Date().toISOString(),
      });
      return apiError(
        c,
        503,
        "dispatch_failed",
        "could not queue the task, try again",
      );
    }
    return c.json({ task_id: task.id, status: task.status }, 202);
  });

  if (verifyWorker) {
    app.post("/internal/run/:id", async (c) => {
      if (!(await verifyWorker(c.req.header("authorization")))) {
        return apiError(c, 401, "unauthorized", "not Cloud Tasks");
      }
      await runTask(c.req.param("id"), deps);
      return c.body(null, 204);
    });
  }

  app.get("/tasks/:id", requireCode, async (c) => {
    const task = await store.get(c.req.param("id"));
    if (!task) return apiError(c, 404, "task_not_found", "task not found");
    return c.json(task);
  });

  app.post("/tasks/:id/cancel", requireCode, async (c) => {
    const task = await store.requestCancel(c.req.param("id"));
    if (!task) return apiError(c, 404, "task_not_found", "task not found");
    return c.json({ task_id: task.id, status: task.status });
  });

  app.post("/tasks/:id/messages", requireCode, async (c) => {
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = MessageRequest.safeParse(raw);
    if (!parsed.success) {
      return apiError(c, 400, "bad_request", z.prettifyError(parsed.error));
    }
    const task = await store.get(id);
    if (!task) return apiError(c, 404, "task_not_found", "task not found");
    if (task.status !== "queued" && task.status !== "running") {
      return apiError(
        c,
        409,
        "task_not_running",
        "task is not running, so it can't be steered",
      );
    }
    const message = await store.appendMessage(id, parsed.data.text);
    return c.json(message, 202);
  });

  app.get("/tasks/:id/events", requireCode, async (c) => {
    const id = c.req.param("id");
    const task = await store.get(id);
    if (!task) return apiError(c, 404, "task_not_found", "task not found");
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
          if (IS_TERMINAL[task.status]) {
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
