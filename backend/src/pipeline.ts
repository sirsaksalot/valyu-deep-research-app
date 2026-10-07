import { setTimeout } from "node:timers/promises";
import {
  GROUPS,
  pricePerResult,
  RESULTS_PER_SEARCH,
  searchGroup,
  type Group,
  type SearchCall,
} from "./search.js";
import type { CitedSource, Source } from "./types.js";

export type ProgressDetails = {
  group?: string;
  query?: string;
  count?: number;
};
export type Progress = (
  message: string,
  details?: ProgressDetails,
) => Promise<void>;

export type PipelineResult = {
  report: string;
  cost: number;
  sources: CitedSource[];
};

export type Pipeline = (
  prompt: string,
  progress: Progress,
) => Promise<PipelineResult>;

export type Pool = Map<string, Source>;

const MAX_ROUNDS = 2;
const SEARCH_BUDGET = 0.1;
// what these calls could cost if every one returns the maximum number of results
const worstCase = (calls: SearchCall[]) =>
  calls.reduce((sum, c) => sum + RESULTS_PER_SEARCH * pricePerResult(c.group), 0);

async function plan(prompt: string): Promise<SearchCall[]> {
  // TODO: change with llm call
  return (Object.keys(GROUPS) as Group[]).map((group) => ({
    group,
    query: prompt,
  }));
}

async function reflect(
  _prompt: string,
  _pool: Pool,
  _round: number,
): Promise<{ done: boolean; followUps: SearchCall[]; reasoning: string }> {
  // TODO: change with llm
  return { done: true, followUps: [], reasoning: "we done!" };
}

function mergeToPool(pool: Pool, sources: Source[]) {
  for (const s of sources) {
    const cur = pool.get(s.id);
    if (!cur) {
      pool.set(s.id, s);
    } else {
      pool.set(s.id, {
        ...cur,
        excerpts: [...cur.excerpts, ...s.excerpts], // might have repeats?
        relevance: Math.max(cur.relevance ?? 0, s.relevance ?? 0),
      });
    }
  }
}

async function runSearches(calls: SearchCall[], progress: Progress) {
  const results = await Promise.all(
    calls.map(async (call) => {
      const { group, query } = call;
      await progress(`searching ${group}: ${query}`, { group, query });
      const res = await searchGroup(call);
      await progress(`found ${res.sources.length} in ${group}`, {
        group,
        query,
        count: res.sources.length,
      });
      return res;
    }),
  );
  return {
    sources: results.flatMap((r) => r.sources),
    cost: results.reduce((sum, r) => sum + r.cost, 0),
  };
}

export const valyuPipeline: Pipeline = async (prompt, progress) => {
  const pool: Pool = new Map();
  let cost = 0;
  let calls = await plan(prompt);

  for (let round = 1; round <= MAX_ROUNDS && calls.length > 0; round++) {
    if (cost + worstCase(calls) > SEARCH_BUDGET) {
      await progress(`search budget reached after ${round - 1} rounds`);
      break;
    }
    const res = await runSearches(calls, progress);
    cost += res.cost;
    mergeToPool(pool, res.sources);
    const next = await reflect(prompt, pool, round);
    await progress(
      next.done ? "done searching" : `searching more: ${next.reasoning}`,
    );
    if (next.done) break;
    calls = next.followUps;
  }

  const sources: CitedSource[] = pool
    .values()
    .toArray()
    .map((s, i) => ({ ...s, n: i + 1 }));
  await progress(`crafting report from ${sources.length} unique sources`);
  const report = [
    `# ${prompt}`,
    "",
    ...sources.map(
      (s) =>
        `${s.n}. [${s.title}](${s.url}) (${s.publicationDate?.slice(0, 4) ?? "n.d."}, ${s.provider})`,
    ),
  ].join("\n");
  return { report, cost, sources };
};

export const fakePipeline: Pipeline = async (prompt, progress) => {
  await progress("planning searches");
  await setTimeout(1000);
  await progress("searching");
  await setTimeout(1000);
  if (prompt.toLowerCase().includes("fail")) {
    throw new Error("fake search outage");
  }
  await progress("writing report");
  await setTimeout(1000);

  const report = [
    `# ${prompt}`,
    "",
    "This is research report! citation [1]",
    "",
    "## Sources",
    "1. [Example source](https://example.com)",
  ].join("\n");
  return { report, cost: 0, sources: [] };
};
