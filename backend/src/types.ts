import type { Tokens } from "./agent.js";
import type { Scope, SearchCall } from "./search.js";

export type LlmUsage = { model: string; tokens: Tokens; cost: number };

export type TraceBody = { round: number } & (
  | ({ type: "plan"; calls: SearchCall[] } & LlmUsage)
  | {
      type: "search";
      scope: Scope;
      query: string;
      instructions?: string;
      startDate?: string;
      endDate?: string;
      found: number;
      newSources: number;
      cost: number;
      error?: string;
    }
  | ({
      type: "reflect";
      notes: string;
      gaps: string[];
      done: boolean;
      followUps: SearchCall[];
    } & LlmUsage)
  | ({ type: "write"; cited: number; claimsDropped: number } & LlmUsage)
  | {
      type: "error";
      step: "plan" | "reflect" | "write";
      message: string;
      cost: number;
    }
  | { type: "user"; text: string }
  | { type: "status"; message: string }
);

export type TraceEvent = TraceBody & { id: number; at: string };
export type SearchRecord = Extract<TraceBody, { type: "search" }>;

export type TaskSummary = Pick<
  Task,
  "id" | "prompt" | "status" | "error" | "createdAt" | "updatedAt" | "cost"
>;

export type TaskCost = { search: number; llm: number; total: number };

export type UserMessage = { id: number; at: string; text: string };

export type TaskStatus =
  "queued" | "running" | "cancelling" | "cancelled" | "failed" | "completed";

export const IS_TERMINAL: Record<TaskStatus, boolean> = {
  queued: false,
  running: false,
  cancelling: false,
  cancelled: true,
  failed: true,
  completed: true,
};

export type Task = {
  id: string;
  status: TaskStatus;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  prompt: string;
  updatedAt: string;
  cost: TaskCost;
  events: TraceEvent[];
  messages: UserMessage[];
  report: string | null;
  sources: CitedSource[];
};

export const newTask = (prompt: string): Task => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    status: "queued",
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    prompt,
    cost: { search: 0, llm: 0, total: 0 },
    events: [],
    messages: [],
    report: null,
    sources: [],
  };
};

export type Source = {
  id: string; // dedupe key: doi, else url
  title: string;
  url: string;
  authors?: string[];
  publicationDate?: string;
  doi?: string;
  provider: string; //"valyu/valyu-pubmed, web
  sourceType?: string;
  abstract?: string;
  excerpts: string[]; // trimmed to RESPONSE_LENGTH chars

  relevance?: number;
  citationCount?: number;
};

export type CitedSource = Source & { n: number };
