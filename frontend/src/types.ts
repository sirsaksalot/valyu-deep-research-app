export type Scope = "literature" | "preprints" | "trials" | "web";

export type SearchCall = {
  scope: Scope;
  query: string;
  instructions?: string;
  startDate?: string;
  endDate?: string;
};

export type Tokens = { in: number; out: number; thoughts: number };

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
  // steering messages are emitted with round 0, in the order they were read:
  // place them by event id, not by round
  | { type: "user"; text: string }
  | { type: "status"; message: string }
);

export type TraceEvent = TraceBody & { id: number; at: string };

export type TaskCost = { search: number; llm: number; total: number };

export type UserMessage = { id: number; at: string; text: string };

export type Source = {
  id: string;
  title: string;
  url: string;
  authors?: string[];
  publicationDate?: string;
  doi?: string;
  provider: string;
  sourceType?: string;
  abstract?: string;
  excerpts: string[];
  relevance?: number;
  citationCount?: number;
};

export type CitedSource = Source & { n: number };

export type Task = {
  id: string;
  status: TaskStatus;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  prompt: string;
  cost: TaskCost;
  events: TraceEvent[];
  messages: UserMessage[];
  report: string | null;
  sources: CitedSource[];
};

export type TaskSummary = Pick<
  Task,
  "id" | "prompt" | "status" | "error" | "createdAt" | "updatedAt" | "cost"
>;
