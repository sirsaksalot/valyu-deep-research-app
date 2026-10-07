import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { MemoryStore, FirestoreStore } from "./store.js";
import { fakePipeline, valyuPipeline } from "./pipeline.js";
import { loadPrices } from "./search.js";

const app = buildApp({
  store:
    process.env.STORE === "firestore"
      ? new FirestoreStore()
      : new MemoryStore(),
  pipeline: process.env.PIPELINE === "valyu" ? valyuPipeline : fakePipeline,
});

if (process.env.PIPELINE === "valyu") await loadPrices();

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port: port }, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`);
});
