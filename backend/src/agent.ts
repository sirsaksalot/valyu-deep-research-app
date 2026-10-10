import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";

const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: "global",
});

const PRICES: Record<string, { in: number; out: number }> = {
  "gemini-3.8-flash": { in: 1.5 / 1e6, out: 7.5 / 1e6 },
  "gemini-3.1-flash-lite": { in: 0.25 / 1e6, out: 1.5 / 1e6 },
  "gemini-3-flash-preview": { in: 0.5 / 1e6, out: 3.0 / 1e6 },
};

const FALLBACK_PRICE = { in: 2.0 / 1e6, out: 12.0 / 1e6 };

export type Tokens = { in: number; out: number; thoughts: number };

export type GenerateJsonArgs<T> = {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export async function generateJson<T>({
  model,
  system,
  prompt,
  schema,
  maxOutputTokens = 4096,
  signal,
}: GenerateJsonArgs<T>): Promise<{ data: T; cost: number; tokens: Tokens }> {
  const res = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(schema),
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      maxOutputTokens,
      abortSignal: signal,
    },
  });

  const u = res.usageMetadata ?? {};
  const tokens: Tokens = {
    in: u.promptTokenCount ?? 0,
    out: u.candidatesTokenCount ?? 0,
    thoughts: u.thoughtsTokenCount ?? 0,
  };

  const price = PRICES[model] ?? FALLBACK_PRICE;
  const cost =
    tokens.in * price.in + (tokens.out + tokens.thoughts) * price.out;

  const text = res.text;
  if (!text) {
    const reason = res.candidates?.[0]?.finishReason ?? "unknown";
    throw new LlmOutputError(`${model} returned no text (${reason})`, cost);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LlmOutputError(`${model} returned invalid JSON`, cost);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new LlmOutputError(
      `${model} output failed validation: ${z.prettifyError(parsed.error)}`,
      cost,
    );
  }

  return { data: parsed.data, cost, tokens };
}

export class LlmOutputError extends Error {
  constructor(
    message: string,
    readonly cost: number,
  ) {
    super(message);
    this.name = "LlmOutputError";
  }
}
