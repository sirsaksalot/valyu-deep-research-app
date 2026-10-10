import { Cancelled, type Pipeline, type PipelineDeps } from "./pipeline.js";
import { errMsg } from "./retry.js";
import type { TaskStore } from "./store.js";
import type { TaskCost, TraceBody, TraceEvent } from "./types.js";

const now = () => new Date().toISOString();
export type WorkerDeps = { store: TaskStore; pipeline: Pipeline };

export async function runTask(id: string, deps: WorkerDeps) {
  const { store, pipeline } = deps;
  const task = await store.claim(id);
  if (!task) return;

  const cost: TaskCost = { search: 0, llm: 0, total: 0 };
  const addCost = (e: TraceBody) => {
    if (!("cost" in e)) return;
    if (e.type === "search") cost.search += e.cost;
    else cost.llm += e.cost;
    cost.total = cost.search + cost.llm;
  };
  let seq = 0;
  let steerCursor = 0;

  const emit: PipelineDeps["emit"] = async (body) => {
    const event: TraceEvent = { ...body, id: seq++, at: now() };
    addCost(event);
    try {
      await store.appendEvent(id, event);
    } catch (err) {
      console.error(`task ${id}: event ${event.id} not saved`, err);
    }
  };

  const checkpoint: PipelineDeps["checkpoint"] = async () => {
    const cur = await store.get(id);
    if (!cur) throw new Error(`task ${id} disappeared`);
    if (cur.status === "cancelling") throw new Cancelled();
    const messages = cur.messages.slice(steerCursor);
    if (messages.length > 0) {
      steerCursor += messages.length;
      for (const m of messages)
        await emit({ type: "user", round: 0, text: m.text });
    }
    return messages;
  };

  try {
    const result = await pipeline(task.prompt, { emit, checkpoint });
    await store.update(id, {
      status: "completed",
      report: result.report,
      sources: result.sources,
      cost,
      finishedAt: now(),
    });
  } catch (err) {
    if (err instanceof Cancelled) {
      await store.update(id, { status: "cancelled", cost, finishedAt: now() });
      return;
    }
    await store.update(id, {
      status: "failed",
      error: { code: "pipeline_error", message: errMsg(err) },
      cost,
      finishedAt: now(),
    });
  }
}
