export type TaskEvent = {
  id: number;
  source?: string;
  at: string;
  message: string;
  group?: string;
  query?: string;
  count?: number;
};

export type TaskStatus = "queued" | "running" | "failed" | "completed";

export type Task = {
  id: string;
  status: TaskStatus;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  prompt: string;
  cost: number;
  budget: number;
  events: TaskEvent[];
  report: string | null;
  sources: CitedSource[];
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
  excerpts: string[]; // content → string → cut to ~1500 chars

  relevance?: number;
  citationCount?: number;
};

// After select: numbered for this report. The LLM cites by `n`, the frontend shows [n].
export type CitedSource = Source & { n: number };
