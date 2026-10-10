import { setTimeout } from "node:timers/promises";
import {
  generateJson,
  LlmOutputError,
  type GenerateJsonArgs,
} from "./agent.js";
import { errMsg, withRetry } from "./retry.js";
import {
  PLAN_PROMPT,
  PlanSchema,
  planInput,
  REFLECT_PROMPT,
  ReflectSchema,
  reflectInput,
  WRITE_PROMPT,
  ReportSchema,
  writeInput,
  type Report,
} from "./prompts.js";
import {
  pricePerResult,
  RESULTS_PER_SEARCH,
  searchScope,
  type SearchCall,
} from "./search.js";
import type {
  CitedSource,
  SearchRecord,
  Source,
  TraceBody,
  UserMessage,
} from "./types.js";

export type PipelineDeps = {
  emit: (event: TraceBody) => Promise<void>;
  // throws Cancelled
  checkpoint: () => Promise<UserMessage[]>;
};

export type PipelineResult = {
  report: string;
  sources: CitedSource[];
};

export type Pipeline = (
  prompt: string,
  deps: PipelineDeps,
) => Promise<PipelineResult>;

export class Cancelled extends Error {
  constructor() {
    super("cancelled by user");
    this.name = "Cancelled";
  }
}

export type Pool = Map<string, Source>;

const MODEL_PLAN = process.env.MODEL_PLAN ?? "gemini-3.8-flash";
const MODEL_WRITE = process.env.MODEL_WRITE ?? "gemini-3.8-flash";
const MAX_ROUNDS = 4;
const SEARCH_BUDGET = 1.0;
const LLM_BUDGET = 1.0;
const DEADLINE_MS = 10 * 60_000;

const worstCase = (calls: SearchCall[]) =>
  calls.reduce(
    (sum, c) => sum + RESULTS_PER_SEARCH * pricePerResult(c.scope),
    0,
  );

const today = () => new Date().toISOString().slice(0, 10);

function mergeToPool(pool: Pool, sources: Source[]): number {
  let added = 0;
  for (const s of sources) {
    const cur = pool.get(s.id);
    if (!cur) {
      pool.set(s.id, s);
      added++;
    } else {
      pool.set(s.id, {
        ...cur,
        excerpts: [...new Set([...cur.excerpts, ...s.excerpts])],
        relevance: Math.max(cur.relevance ?? 0, s.relevance ?? 0),
      });
    }
  }
  return added;
}

export type SearchFn = typeof searchScope;

export const makeValyuPipeline =
  (search: SearchFn = searchScope): Pipeline =>
  async (prompt, deps) => {
    const { emit, checkpoint } = deps;
    const deadline = Date.now() + DEADLINE_MS;

    const pool: Pool = new Map();
    const searched: SearchRecord[] = [];
    let notes = "";
    let searchCost = 0;
    let llmCost = 0;
    const steers: string[] = [];
    let newSteer = false;

    const check = async () => {
      const messages = await checkpoint();
      steers.push(...messages.map((m) => m.text));
      if (messages.length > 0) newSteer = true;
    };

    const stopEarly = (round: number, reason: string) =>
      emit({
        type: "status",
        round,
        message: `${reason} reached, writing with what we have`,
      });

    const llm = async <T>(
      step: "plan" | "reflect" | "write",
      args: GenerateJsonArgs<T>,
    ) => {
      try {
        const res = await withRetry(
          `gemini ${step}`,
          (signal) => generateJson({ ...args, signal }),
          { timeoutMs: step === "write" ? 120_000 : 60_000 },
        );
        llmCost += res.cost;
        return res;
      } catch (err) {
        const cost = err instanceof LlmOutputError ? err.cost : 0;
        llmCost += cost;
        await emit({
          type: "error",
          round: 0,
          step,
          message: errMsg(err),
          cost,
        });
        throw err;
      }
    };

    async function runSearches(calls: SearchCall[], round: number) {
      const results = await Promise.allSettled(
        calls.map((c) =>
          withRetry(`valyu ${c.scope}`, () => search(c), { timeoutMs: 30_000 }),
        ),
      );
      for (const [i, call] of calls.entries()) {
        const r = results[i]!;
        const ev: SearchRecord =
          r.status === "fulfilled"
            ? {
                type: "search",
                round,
                ...call,
                found: r.value.sources.length,
                newSources: mergeToPool(pool, r.value.sources),
                cost: r.value.cost,
              }
            : {
                type: "search",
                round,
                ...call,
                found: 0,
                newSources: 0,
                cost: 0,
                error: errMsg(r.reason),
              };
        searchCost += ev.cost;
        searched.push(ev);
        await emit(ev);
      }
      if (results.every((r) => r.status === "rejected")) {
        throw new Error(
          `all ${calls.length} searches in round ${round} failed`,
        );
      }
    }

    async function reflect(round: number): Promise<SearchCall[]> {
      if (llmCost >= LLM_BUDGET) {
        await stopEarly(round, "LLM budget");
        return [];
      }
      newSteer = false;
      const { data, cost, tokens } = await llm("reflect", {
        model: MODEL_PLAN,
        system: REFLECT_PROMPT,
        schema: ReflectSchema,
        prompt: reflectInput({
          question: prompt,
          today: today(),
          round,
          maxRounds: MAX_ROUNDS,
          notes,
          searched,
          pool: [...pool.values()],
          steers,
        }),
      });
      notes = data.notes;

      const followUps = data.done ? [] : data.followUps;
      await emit({
        type: "reflect",
        round,
        notes,
        gaps: data.gaps,
        done: data.done,
        followUps,
        model: MODEL_PLAN,
        tokens,
        cost,
      });
      return followUps;
    }

    const plan = await llm("plan", {
      model: MODEL_PLAN,
      system: PLAN_PROMPT,
      schema: PlanSchema,
      prompt: planInput(prompt, today()),
    });
    let calls = plan.data.calls;
    await emit({
      type: "plan",
      round: 0,
      calls,
      model: MODEL_PLAN,
      tokens: plan.tokens,
      cost: plan.cost,
    });

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      await check();
      // replan on new steer
      if (newSteer && llmCost < LLM_BUDGET) {
        calls = await reflect(round - 1);
      }
      if (calls.length === 0) break;
      if (Date.now() > deadline) {
        await stopEarly(round, "time limit");
        break;
      }
      if (searchCost + worstCase(calls) > SEARCH_BUDGET) {
        await stopEarly(round, "search budget");
        break;
      }

      await runSearches(calls, round);
      await check();

      if (round === MAX_ROUNDS) break;
      calls = await reflect(round);
    }

    await check();
    if (pool.size === 0) throw new Error("no sources found for this question");

    const candidates: CitedSource[] = [...pool.values()]
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
      .map((s, i) => ({ ...s, n: i + 1 }));

    const { data, cost, tokens } = await llm("write", {
      model: MODEL_WRITE,
      system: WRITE_PROMPT,
      schema: ReportSchema,
      maxOutputTokens: 8192,
      prompt: writeInput({
        question: prompt,
        notes,
        steers,
        sources: candidates,
      }),
    });

    const { report, cited, claimsDropped } = renderReport(data, candidates);
    await emit({
      type: "write",
      round: 0,
      cited: cited.length,
      claimsDropped,
      model: MODEL_WRITE,
      tokens,
      cost,
    });
    return { report, sources: cited };
  };

export const valyuPipeline = makeValyuPipeline();

// renumber & drop unused
export function renderReport(data: Report, candidates: CitedSource[]) {
  const byN = new Map(candidates.map((s) => [s.n, s]));
  const renumber = new Map<number, number>();
  const cited: CitedSource[] = [];
  let claimsDropped = 0;

  const cite = (ids: number[]) => {
    const valid = [...new Set(ids)].filter((n) => byN.has(n));
    return valid.map((n) => {
      if (!renumber.has(n)) {
        renumber.set(n, cited.length + 1);
        cited.push({ ...byN.get(n)!, n: cited.length + 1 });
      }
      const k = renumber.get(n)!;
      return `[[${k}]](${byN.get(n)!.url})`;
    });
  };

  const claim = (c: { text: string; sourceIds: number[] }) => {
    const refs = cite(c.sourceIds);
    if (refs.length === 0) {
      claimsDropped++;
      return null;
    }
    return `${c.text.trim()} ${refs.join("")}`;
  };

  const lines: string[] = [`# ${data.title}`, ""];

  const findings = data.keyFindings.map(claim).filter((x) => x !== null);
  if (findings.length) {
    lines.push("## Key findings", "", ...findings.map((f) => `- ${f}`), "");
  }
  for (const section of data.sections) {
    const body = section.claims.map(claim).filter((x) => x !== null);
    if (body.length === 0) continue;
    lines.push(`## ${section.heading}`, "", body.join(" "), "");
  }
  if (cited.length === 0) {
    throw new Error("report had no claims backed by a valid source");
  }
  if (data.limitations.length) {
    lines.push(
      "## Limitations",
      "",
      ...data.limitations.map((l) => `- ${l}`),
      "",
    );
  }
  lines.push(
    "## Sources",
    "",
    ...cited.map((s) => {
      const meta = [
        s.authors?.slice(0, 3).join(", "),
        s.publicationDate?.slice(0, 4),
        s.provider,
      ]
        .filter(Boolean)
        .join(" · ");
      return `${s.n}. [${s.title}](${s.url})${meta ? ` (${meta})` : ""}`;
    }),
  );
  return { report: lines.join("\n"), cited, claimsDropped };
}

export const fakePipeline: Pipeline = async (prompt, { emit, checkpoint }) => {
  const status = (message: string) =>
    emit({ type: "status", round: 0, message });
  await status("planning searches");
  await setTimeout(1000);
  await checkpoint();
  await status("searching");
  await setTimeout(1000);
  if (prompt.toLowerCase().includes("fail")) {
    throw new Error("fake search outage");
  }
  await checkpoint();
  await status("writing report");
  await setTimeout(1000);

  const report = [
    `# ${prompt}`,
    "",
    "This is research report! citation [[1]](https://example.com)",
    "",
    "## Sources",
    "1. [Example source](https://example.com)",
  ].join("\n");
  return { report, sources: [] };
};
