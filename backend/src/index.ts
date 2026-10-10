import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { MemoryStore, FirestoreStore } from "./store.js";
import { fakePipeline, valyuPipeline } from "./pipeline.js";
import { loadPrices } from "./search.js";
import {
  cloudTasksDispatch,
  cloudTasksVerifier,
  inProcessDispatch,
} from "./queue.js";

const workerDeps = {
  store:
    process.env.STORE === "firestore"
      ? new FirestoreStore()
      : new MemoryStore(),
  pipeline: process.env.PIPELINE === "valyu" ? valyuPipeline : fakePipeline,
};
const useCloudTasks = process.env.QUEUE === "cloudtasks";

const app = buildApp({
  ...workerDeps,
  dispatch: useCloudTasks
    ? cloudTasksDispatch()
    : inProcessDispatch(workerDeps),
  verifyWorker: useCloudTasks ? cloudTasksVerifier() : undefined,
});

if (process.env.PIPELINE === "valyu") await loadPrices();

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port: port }, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`);
});
