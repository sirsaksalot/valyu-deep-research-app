import type { Pipeline, Progress } from "./pipeline.js";
import type { TaskStore } from "./store.js";
import type { TaskEvent } from "./types.js";

const now = () => new Date().toISOString();
export type WorkerDeps = { store: TaskStore; pipeline: Pipeline };

export async function runTask(id: string, deps: WorkerDeps) {
  const { store, pipeline } = deps;
  const task = await store.get(id);
  if (!task) throw new Error(`task ${id} not found`);
  if (task.status !== "queued") return; // todo: check
  await store.update(id, { status: "running", startedAt: now() });

  let seq = 0;
  let eventChain: Promise<void> = Promise.resolve();
  const progress: Progress = (message, details) => {
    const event: TaskEvent = { id: seq++, at: now(), message, ...details };
    eventChain = eventChain
      .then(() => store.appendEvent(id, event))
      .catch((err) =>
        console.error(`task ${id}: event ${event.id} not saved`, err),
      );
    return eventChain;
  };
  try {
    const result = await pipeline(task.prompt, progress);
    await eventChain;
    await store.update(id, {
      status: "completed",
      report: result.report,
      cost: result.cost,
      sources: result.sources,
      finishedAt: now(),
    });
  } catch (err) {
    await eventChain;
    const msg = err instanceof Error ? err.message : String(err);
    // TODO: add in the budget exceed failure/ store.update failures
    await store.update(id, {
      status: "failed",
      error: { code: "pipeline_error", message: msg },
      finishedAt: now(),
    });
  }
}
