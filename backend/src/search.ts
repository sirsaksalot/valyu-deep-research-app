import { Valyu } from "valyu-js";
import type { SearchOptions } from "valyu-js";
import type { Source } from "./types.js";

const valyu = new Valyu(process.env.VALYU_API_KEY);
export const RESULTS_PER_SEARCH = 8;
export const RESPONSE_LENGTH = 1500;

export type Group = "literature" | "preprints" | "trials" | "web";
export type SearchCall = {
  group: Group;
  query: string;
  startDate?: string;
  endDate?: string;
};

// thousand
const cpm = new Map<string, number>([
  ["valyu/valyu-pubmed", 1],
  ["valyu/valyu-clinical-trials", 5],
  ["valyu/valyu-arxiv", 1],
  ["valyu/valyu-biorxiv", 1],
  ["valyu/valyu-medrxiv", 1],
  ["web", 1.5], // measured
]);

export async function loadPrices() {
  try {
    const res = await valyu.datasources.list();
    for (const d of res.datasources ?? []) {
      if (d.pricing?.cpm != null) cpm.set(d.id, d.pricing.cpm);
    }
  } catch (err) {
    console.warn("valyu prices: using fallbacks", err);
  }
}

export function pricePerResult(group: Group): number {
  const ids = GROUPS[group].includedSources ?? ["web"];
  return Math.max(...ids.map((id) => cpm.get(id) ?? 10)) / 1000;
}

export const GROUPS: Record<Group, SearchOptions> = {
  literature: {
    searchType: "proprietary",
    includedSources: ["valyu/valyu-pubmed"],
    includeAbstracts: true,
  },
  web: {
    searchType: "web",
  },
  preprints: {
    searchType: "proprietary",
    includedSources: [
      "valyu/valyu-arxiv",
      "valyu/valyu-biorxiv",
      "valyu/valyu-medrxiv",
    ],
  },
  trials: {
    searchType: "proprietary",
    includedSources: ["valyu/valyu-clinical-trials"],
  },
};

const isHttpURL = (u: string) => /^https?:\/\//i.test(u);

export async function searchGroup(
  call: SearchCall,
): Promise<{ sources: Source[]; cost: number }> {
  const { group, query, startDate, endDate } = call;

  const res = await valyu.search(query, {
    ...GROUPS[group],
    startDate: startDate,
    endDate: endDate,
    maxNumResults: RESULTS_PER_SEARCH,
    responseLength: RESPONSE_LENGTH,
  });
  if (!res.success) {
    throw new Error(`valyu ${group} search failed: ${res.error}`);
  }
  const filtered = res.results.filter(
    (r) => r.title && r.url && isHttpURL(r.url),
  );
  const dropped = res.results.length - filtered.length;
  if (dropped > 0) {
    console.warn(
      `valyu ${group}: dropped ${dropped} results without title/http url`,
    );
  }
  const sources = filtered.map((r) => ({
    id: r.doi || r.url,
    title: r.title,
    url: r.url,
    authors: r.authors,
    publicationDate: r.publication_date || undefined,
    doi: r.doi,
    provider: r.source,
    sourceType: r.source_type,
    abstract: r.abstract,
    excerpts: [
      (typeof r.content === "string"
        ? r.content
        : JSON.stringify(r.content)
      ).slice(0, RESPONSE_LENGTH),
    ],
    relevance: r.relevance_score,
    citationCount: r.citation_count,
  }));
  return { sources: sources, cost: res.total_deduction_dollars ?? 0 }; // missing when a search finds nothing
}
