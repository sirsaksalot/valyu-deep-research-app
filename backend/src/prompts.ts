import { z } from "zod";
import { SearchCallSchema } from "./search.js";
import type { CitedSource, SearchRecord, Source } from "./types.js";

const SCOPES_GUIDE = `Search scopes:
- literature: PubMed, peer-reviewed papers in medicine, biology and the life sciences ONLY.
  Use precise scientific terminology: standard names for drugs, genes, diseases and methods, not brand names or slang.
- preprints: research papers from arXiv, bioRxiv and medRxiv.
  The main source for mathematics, physics, computer science, statistics and quantitative fields,
  and for very recent life-science work. Many arXiv papers are later published in journals.
- trials: registered clinical trials (ClinicalTrials.gov).
  Only for questions about treatments, interventions or outcomes in humans.
  Phrase queries as condition + intervention, optionally the phase.
- web: the open web: journals outside the life sciences (chemistry, materials, engineering, earth and climate science),
  institutions, labs, standards bodies, regulators, patents and datasets published online, news and encyclopaedias.
  Useful for fields the other scopes don't cover, for regulatory status and for very recent events.`;

const GOAL = `The end goal is a high-quality research document on this question: well structured, grounded in the sources,
honest about the strength of the evidence and about what is unknown. Your job is to gather the evidence it needs.`;

const QUERY_RULES = `Query rules:
- Each query targets ONE aspect of the question (one effect, one mechanism, one method, one population or material),
  not the whole multi-part question. Write it as a short natural-language phrase or question, not a keyword list.
- No boolean operators, quotes or site: filters.
- Phrase each query in the vocabulary that scope's sources use, so the same idea may be worded differently per scope.
- If the question implies a time period ("recent", "since 2020", "last 5 years"), set startDate/endDate (YYYY-MM-DD)
  using today's date, instead of putting time words in the query.
- instructions (optional, one or two sentences) tells the search engine's reranker what kind of result to prefer
  for this question, e.g. "prefer randomised controlled trials in adults", "prefer papers with proofs or formal results",
  "prefer experimental measurements over reviews". Leave it out if there is nothing specific.`; // see how this field works

export const PLAN_PROMPT = `You plan literature searches for a research question in any scientific or technical field.
First work out which field(s) the question belongs to, then choose which scopes to search and write one focused query for each.
${GOAL}

${SCOPES_GUIDE}

${QUERY_RULES}

Plan rules:
- Only include scopes that can plausibly contain evidence for this question. Skip the others.
- This is the first of several search rounds. After each round you will see what was found
  and can search again. Start with the 1–3 searches most likely to answer the core question;
  don't try to cover every angle now.`;

export const PlanSchema = z.object({
  calls: z.array(SearchCallSchema).min(1).max(3),
});

export const planInput = (question: string, today: string) =>
  `Today: ${today}\nQuestion: ${question}`;

export const REFLECT_PROMPT = `You review the progress of a literature search for a research question in any scientific or technical field,
and decide whether to search again.
${GOAL}

You get: the question, your notes so far, every search already run (with how many results and how many were new),
the sources found so far, and any messages from the user.

${SCOPES_GUIDE}

${QUERY_RULES}

Reflect rules:
- notes: rewrite your notes from scratch. Keep what is established, by whom (cite source titles briefly),
  and where sources disagree. Keep them under 300 words. They are your only memory between rounds.
  Only record what the listed sources say. Never add facts from your own knowledge: if you expect a study or result
  to exist but it is not in the sources, put it in gaps and search for it.
- gaps: the parts of the question the sources do not yet answer. Be specific.
- done: true if the sources are enough to write a useful, honest report, or if further searching is unlikely to help.
- followUps: up to 3 new searches, each aimed at one gap. Never repeat or lightly rephrase a search already run.
  If a search returned few new sources, change scope or angle instead of rewording it.
  Leave empty when done is true.
- If the user sent messages, treat them as instructions that override your plan: adjust gaps and followUps to follow them.`;

export const ReflectSchema = z.object({
  notes: z.string().max(4000),
  gaps: z.array(z.string()).max(5),
  done: z.boolean(),
  followUps: z.array(SearchCallSchema).max(3),
});

const formatSearched = (searched: SearchRecord[]) =>
  searched
    .map(
      (s) =>
        `- round ${s.round} · ${s.scope} · "${s.query}"` +
        (s.startDate || s.endDate
          ? ` · ${s.startDate ?? "…"} to ${s.endDate ?? "…"}`
          : "") +
        ` → ${s.found} found, ${s.newSources} new` +
        (s.error ? ` (failed: ${s.error})` : ""),
    )
    .join("\n");

const year = (s: Source) => s.publicationDate?.slice(0, 4) ?? "n.d.";

const formatPoolCompact = (pool: Source[]) =>
  pool
    .map(
      (s) =>
        `- ${s.title} (${year(s)}, ${s.sourceType ?? "unknown"}, ${s.provider})\n` +
        `  ${(s.abstract ?? s.excerpts[0] ?? "").replace(/\s+/g, " ").slice(0, 200)}`,
    )
    .join("\n");

export const reflectInput = (args: {
  question: string;
  today: string;
  round: number;
  maxRounds: number;
  notes: string;
  searched: SearchRecord[];
  pool: Source[];
  steers: string[];
}) =>
  [
    `Today: ${args.today}`,
    `Question: ${args.question}`,
    `Round ${args.round} of at most ${args.maxRounds} just finished.`,
    "",
    "Your notes so far:",
    args.notes || "(none yet)",
    "",
    "Searches already run:",
    formatSearched(args.searched),
    "",
    `Sources found so far (${args.pool.length}):`,
    formatPoolCompact(args.pool),
    ...(args.steers.length
      ? [
          "",
          "Messages from the user, oldest first. Follow them all; if a later one contradicts an earlier one, the later one wins:",
          ...args.steers.map((s) => `- ${s}`),
        ]
      : []),
  ].join("\n");

export const WRITE_PROMPT = `You write a high-quality research document for a question in any scientific or technical field,
using only the numbered sources provided. It should read like a careful expert's briefing: concise, well structured,
grounded in the sources, and honest about the strength of the evidence and about what is unknown.

Rules:
- Every claim must cite the sources that support it, by their numbers, in sourceIds.
  Only cite a source for what it actually says. Never cite a number that is not in the list.
- Do not use outside knowledge for factual claims. If the sources don't cover something, say so in limitations.
- Say what kind of evidence backs each important claim, in the terms of the field: e.g. proof, experiment, simulation,
  benchmark, randomised trial, meta-analysis, observational study, review, registered trial without results, patent,
  dataset, preprint (not yet peer reviewed), news report. Note when sources disagree.
- keyFindings: 3–5 claims that directly answer the question.
- sections: 2–5 sections that give the detail behind the findings.
- limitations: what the evidence does not show, missing source types, preprints not yet peer reviewed, and so on.
- Write claim text as plain prose without citation markers; the numbers go in sourceIds only.
- If the user sent messages during the research, follow them in what you focus on and how you structure the report,
  but only as far as the sources allow.`;

const ClaimSchema = z.object({
  text: z.string(),
  sourceIds: z.array(z.number().int()),
});

export const ReportSchema = z.object({
  title: z.string(),
  keyFindings: z.array(ClaimSchema).max(6),
  sections: z
    .array(z.object({ heading: z.string(), claims: z.array(ClaimSchema) }))
    .max(6),
  limitations: z.array(z.string()).max(6),
});
export type Report = z.infer<typeof ReportSchema>;

const formatSource = (s: CitedSource) =>
  [
    `[${s.n}] ${s.title}`,
    `    ${[
      year(s),
      s.sourceType,
      s.provider,
      s.authors?.slice(0, 3).join(", "),
      s.doi && `doi:${s.doi}`,
    ]
      .filter(Boolean)
      .join(" · ")}`,
    s.abstract && `    Abstract: ${s.abstract.replace(/\s+/g, " ")}`,
    ...s.excerpts.map((e) => `    Excerpt: ${e.replace(/\s+/g, " ")}`),
  ]
    .filter(Boolean)
    .join("\n");

export const writeInput = (args: {
  question: string;
  notes: string;
  steers: string[];
  sources: CitedSource[];
}) =>
  [
    `Question: ${args.question}`,
    ...(args.steers.length
      ? [
          "",
          "Messages from the user, oldest first. Follow them all; if a later one contradicts an earlier one, the later one wins:",
          ...args.steers.map((s) => `- ${s}`),
        ]
      : []),
    "",
    "Research notes:",
    args.notes || "(none)",
    "",
    `Sources (${args.sources.length}):`,
    ...args.sources.map(formatSource),
  ].join("\n");
