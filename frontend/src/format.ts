import type { Scope, TaskStatus } from "./types";

export function money(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.001) return "<$0.001";
  return `$${n.toFixed(3)}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function duration(
  fromIso: string | null,
  toIso: string | null,
  now = Date.now(),
) {
  if (!fromIso) return "";
  const ms =
    (toIso ? new Date(toIso).getTime() : now) - new Date(fromIso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Queued",
  running: "Researching",
  cancelling: "Cancelling",
  cancelled: "Cancelled",
  failed: "Failed",
  completed: "Completed",
};

export const STATUS_ICON: Record<TaskStatus, string> = {
  queued: "",
  running: "",
  cancelling: "",
  cancelled: "⊘",
  failed: "✕",
  completed: "✓",
};

export const SCOPE_LABEL: Record<Scope, string> = {
  literature: "PubMed",
  preprints: "Preprints",
  trials: "Clinical trials",
  web: "Web",
};

const PROVIDER_LABEL: Record<string, string> = {
  "valyu/valyu-pubmed": "PubMed",
  "valyu/valyu-arxiv": "arXiv",
  "valyu/valyu-biorxiv": "bioRxiv",
  "valyu/valyu-medrxiv": "medRxiv",
  "valyu/valyu-clinical-trials": "ClinicalTrials.gov",
  web: "Web",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider.replace(/^valyu\/valyu-/, "");
}

export function cleanAbstract(text: string): string {
  return text.replace(/^\s*Title:.*?Authors:\s*\[[^\]]*\]\s*/s, "").trim();
}

export function year(date?: string): string {
  return date?.slice(0, 4) ?? "n.d.";
}

export function authorList(authors?: string[]): string {
  if (!authors?.length) return "";
  return authors.length > 3
    ? `${authors.slice(0, 3).join(", ")} et al.`
    : authors.join(", ");
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
