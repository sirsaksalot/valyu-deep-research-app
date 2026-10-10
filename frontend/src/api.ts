import {
  IS_TERMINAL,
  type Task,
  type TaskSummary,
  type UserMessage,
} from "./types";

const BACKEND_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

const CODE_KEY = "deep-research:access-code";
export const accessCode = {
  get: () => localStorage.getItem(CODE_KEY),
  set: (code: string) => localStorage.setItem(CODE_KEY, code),
  clear: () => localStorage.removeItem(CODE_KEY),
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const code = accessCode.get();
  if (code) headers.authorization = `Bearer ${code}`;

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      0,
      "network",
      "Can't reach the research service. Check your connection.",
    );
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) {
      throw new ApiError(401, "unauthorized", "Access code missing or wrong.");
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? "error",
      body?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return body as T;
}

export const api = {
  list: () => request<{ tasks: TaskSummary[] }>("/tasks").then((r) => r.tasks),

  get: (id: string) => request<Task>(`/tasks/${id}`),

  create: (prompt: string) =>
    request<{ task_id: string }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }).then((r) => r.task_id),

  cancel: (id: string) =>
    request<{ status: string }>(`/tasks/${id}/cancel`, { method: "POST" }),

  steer: (id: string, text: string) =>
    request<UserMessage>(`/tasks/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  checkCode: async (code: string) => {
    const res = await fetch(`${BACKEND_URL}/access`, {
      headers: code ? { authorization: `Bearer ${code}` } : {},
    }).catch(() => null);
    return res?.ok ?? false;
  },

  watch(id: string, onTask: (task: Task) => void): () => void {
    const code = accessCode.get();
    const query = code ? `?code=${encodeURIComponent(code)}` : "";
    const es = new EventSource(`${BACKEND_URL}/tasks/${id}/events${query}`);
    es.addEventListener("task", (e) => {
      const task = JSON.parse((e as MessageEvent).data) as Task;
      onTask(task);
      if (IS_TERMINAL[task.status]) es.close();
    });
    return () => es.close();
  },
};
