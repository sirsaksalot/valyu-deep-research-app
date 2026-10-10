import { setTimeout } from "node:timers/promises";
import { LlmOutputError } from "./agent.js";

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms / 1000}s`);
    this.name = "TimeoutError";
  }
}

export const errMsg = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export function isTransient(err: unknown): boolean {
  if (err instanceof LlmOutputError) return false;
  const status = (err as { status?: number }).status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return true; // unknown error
}

export async function withRetry<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
  { attempts = 3, timeoutMs = 60_000 } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = globalThis.setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await Promise.race([
        fn(ctrl.signal),
        new Promise<never>((_, reject) =>
          ctrl.signal.addEventListener("abort", () =>
            reject(new TimeoutError(label, timeoutMs)),
          ),
        ),
      ]);
    } catch (err) {
      if (attempt >= attempts || !isTransient(err)) throw err;
      const wait = 1000 * 2 ** (attempt - 1) + Math.random() * 500;
      console.warn(
        `${label}: attempt ${attempt} failed, retrying in ${Math.round(wait)}ms`,
        errMsg(err),
      );
      await setTimeout(wait);
    } finally {
      clearTimeout(timer);
    }
  }
}
