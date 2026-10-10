import { Valyu } from "valyu-js";
import type { SearchOptions } from "valyu-js";
import { z } from "zod";
import type { Source } from "./types.js";

const valyu = new Valyu(process.env.VALYU_API_KEY);
export const RESULTS_PER_SEARCH = 8;
export const RESPONSE_LENGTH = 5000;

export const SCOPE_NAMES = [
  "literature",
  "preprints",
  "trials",
  "web",
] as const;
export type Scope = (typeof SCOPE_NAMES)[number];

export const SearchCallSchema = z
  .object({
    scope: z.enum(SCOPE_NAMES),
    query: z.string().trim().min(3).max(300),
    instructions: z.string().trim().max(500).optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
  })
  .refine((c) => !c.startDate || !c.endDate || c.startDate <= c.endDate, {
    message: "startDate before EndDate",
  });
export type SearchCall = z.infer<typeof SearchCallSchema>;

const PRICE_PER_RESULT = new Map<string, number>([
  ["valyu/valyu-pubmed", 1 / 1000],
  ["valyu/valyu-clinical-trials", 5 / 1000],
  ["valyu/valyu-arxiv", 1 / 1000],
  ["valyu/valyu-biorxiv", 1 / 1000],
  ["valyu/valyu-medrxiv", 1 / 1000],
  ["web", 1.5 / 1000], // measured
]);

export async function loadPrices() {
  try {
    const res = await valyu.datasources.list();
    for (const d of res.datasources ?? []) {
      if (d.pricing?.cpm != null)
        PRICE_PER_RESULT.set(d.id, d.pricing.cpm / 1000);
    }
  } catch (err) {
    console.warn("valyu prices: using fallbacks", err);
  }
}

export function pricePerResult(scope: Scope): number {
  const ids = SCOPES[scope].includedSources ?? ["web"];
  return Math.max(...ids.map((id) => PRICE_PER_RESULT.get(id) ?? 10 / 1000));
}

export const SCOPES: Record<Scope, SearchOptions> = {
  literature: {
    searchType: "proprietary",
    includedSources: ["valyu/valyu-pubmed"],
    includeAbstracts: true,
    instructions:
      "Prefer primary research, systematic reviews and meta-analyses. Skip editorials, letters and opinion pieces.",
  },
  web: {
    searchType: "web",
    instructions:
      "Prefer journals, universities, research labs, standards bodies and regulators. Skip blogs, forums and content farms.",
  },
  preprints: {
    searchType: "proprietary",
    includedSources: [
      "valyu/valyu-arxiv",
      "valyu/valyu-biorxiv",
      "valyu/valyu-medrxiv",
    ],
    instructions:
      "Prefer papers that state concrete results, methods or proofs. Skip announcements and short abstracts without results.",
  },
  trials: {
    searchType: "proprietary",
    includedSources: ["valyu/valyu-clinical-trials"],
    instructions:
      "Prefer completed or active interventional trials with reported outcomes, later phases first.",
  },
};

const isHttpURL = (u: string) => /^https?:\/\//i.test(u);

export const normDoi = (doi?: string) =>
  doi
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "") || undefined;

export async function searchScope(
  call: SearchCall,
): Promise<{ sources: Source[]; cost: number }> {
  const { scope, query, instructions, startDate, endDate } = call;

  const res = await valyu.search(query, {
    ...SCOPES[scope],
    instructions: instructions ?? SCOPES[scope].instructions,
    startDate,
    endDate,
    maxNumResults: RESULTS_PER_SEARCH,
    responseLength: RESPONSE_LENGTH,
  });
  if (!res.success) {
    throw new Error(`valyu ${scope} search failed: ${res.error}`);
  }
  if (res.error) {
    console.warn(`valyu ${scope}: partial result: ${res.error}`);
  }
  const sources = res.results
    .filter((r) => r.title && r.url && isHttpURL(r.url))
    .map((r) => ({
      id: normDoi(r.doi) ?? r.url,
      title: r.title,
      url: r.url,
      authors: r.authors,
      publicationDate: r.publication_date || undefined,
      doi: normDoi(r.doi),
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
  return { sources, cost: res.total_deduction_dollars ?? 0 };
}
