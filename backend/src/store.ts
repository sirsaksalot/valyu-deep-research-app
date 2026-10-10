import type { Task, TaskSummary, TraceEvent, UserMessage } from "./types.js";
import { EventEmitter } from "node:events";
import { Firestore, FieldValue } from "@google-cloud/firestore";

export type TaskUpdate = Partial<Omit<Task, "id" | "createdAt" | "events">>;

const now = () => new Date().toISOString();

const claimUpdate = (t: Task): TaskUpdate | null =>
  t.status === "queued"
    ? { status: "running", startedAt: now(), updatedAt: now() }
    : null;

const cancelUpdate = (t: Task): TaskUpdate | null =>
  t.status === "queued"
    ? { status: "cancelled", finishedAt: now(), updatedAt: now() }
    : t.status === "running"
      ? { status: "cancelling", updatedAt: now() }
      : null;

const SUMMARY_FIELDS = [
  "id",
  "prompt",
  "status",
  "error",
  "createdAt",
  "updatedAt",
  "cost",
] as const;

const toSummary = (t: Task): TaskSummary => ({
  id: t.id,
  prompt: t.prompt,
  status: t.status,
  error: t.error,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  cost: t.cost,
});

export interface TaskStore {
  create: (task: Task) => Promise<void>;
  get: (id: string) => Promise<Task | undefined>;
  update: (id: string, upd: TaskUpdate) => Promise<void>;
  claim: (id: string) => Promise<Task | undefined>;
  requestCancel: (id: string) => Promise<Task | undefined>;
  appendEvent: (id: string, event: TraceEvent) => Promise<void>;
  appendMessage: (id: string, text: string) => Promise<UserMessage>;
  list: (limit: number) => Promise<TaskSummary[]>;
  watch: (id: string, onChange: (task: Task) => void) => () => void;
}

export class FirestoreStore implements TaskStore {
  private db;
  private col;
  constructor() {
    this.db = new Firestore({ ignoreUndefinedProperties: true });
    this.col = this.db.collection("tasks");
  }
  async create(task: Task) {
    await this.col.doc(task.id).create(task); // throws
  }
  async get(id: string) {
    const snap = await this.col.doc(id).get();
    return snap.exists ? (snap.data() as Task) : undefined;
  }
  async update(id: string, taskUpdate: TaskUpdate) {
    await this.col.doc(id).update({ ...taskUpdate, updatedAt: now() });
  }
  async claim(id: string) {
    const ref = this.col.doc(id);
    return this.db.runTransaction(async (tx) => {
      const task = (await tx.get(ref)).data() as Task | undefined;
      const upd = task && claimUpdate(task);
      if (!task || !upd) return undefined;
      tx.update(ref, upd);
      return { ...task, ...upd };
    });
  }
  async requestCancel(id: string) {
    const ref = this.col.doc(id);
    return this.db.runTransaction(async (tx) => {
      const task = (await tx.get(ref)).data() as Task | undefined;
      const upd = task && cancelUpdate(task);
      if (!task || !upd) return task;
      tx.update(ref, upd);
      return { ...task, ...upd };
    });
  }
  async appendEvent(id: string, event: TraceEvent) {
    await this.col.doc(id).update({
      events: FieldValue.arrayUnion(event),
      updatedAt: now(),
    });
  }
  async appendMessage(id: string, text: string) {
    const message: UserMessage = { id: Date.now(), at: now(), text };
    await this.col.doc(id).update({
      messages: FieldValue.arrayUnion(message),
      updatedAt: now(),
    });
    return message;
  }
  async list(limit: number) {
    const snap = await this.col
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .select(...SUMMARY_FIELDS)
      .get();
    return snap.docs.map((d) => d.data() as TaskSummary);
  }
  watch(id: string, onChange: (task: Task) => void): () => void {
    return this.col.doc(id).onSnapshot(
      (snap) => {
        if (snap.exists) onChange(snap.data() as Task);
      },
      (err) => {
        console.error(`watch ${id} failed`, err);
      },
    );
  }
}

export class MemoryStore implements TaskStore {
  private tasks = new Map<string, Task>();
  private changes = new EventEmitter();

  async create(task: Task) {
    if (this.tasks.has(task.id)) {
      throw new Error(`task ${task.id} already exists`);
    }
    this.tasks.set(task.id, structuredClone(task));
  }

  async get(id: string) {
    const task = this.tasks.get(id);
    return task && structuredClone(task);
  }

  async update(id: string, upd: TaskUpdate) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`task ${id} not found`);
    Object.assign(task, upd, { updatedAt: now() });
    this.changes.emit(id, structuredClone(task));
  }

  async claim(id: string) {
    const task = this.tasks.get(id);
    const upd = task && claimUpdate(task);
    if (!task || !upd) return undefined;
    await this.update(id, upd);
    return structuredClone(task);
  }

  async requestCancel(id: string) {
    const task = this.tasks.get(id);
    const upd = task && cancelUpdate(task);
    if (upd) await this.update(id, upd);
    return task && structuredClone(task);
  }

  async appendEvent(id: string, event: TraceEvent) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`task ${id} not found`);
    task.events.push(structuredClone(event));
    task.updatedAt = now();
    this.changes.emit(id, structuredClone(task));
  }

  async appendMessage(id: string, text: string) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`task ${id} not found`);
    const message: UserMessage = { id: Date.now(), at: now(), text };
    task.messages.push(message);
    task.updatedAt = now();
    this.changes.emit(id, structuredClone(task));
    return message;
  }

  async list(limit: number) {
    return [...this.tasks.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(toSummary);
  }

  watch(id: string, onChange: (task: Task) => void): () => void {
    this.changes.on(id, onChange);
    const task = this.tasks.get(id);
    // get client up to speed
    if (task) onChange(structuredClone(task));
    return () => this.changes.off(id, onChange);
  }
}
