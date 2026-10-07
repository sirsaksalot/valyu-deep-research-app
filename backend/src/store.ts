import type { Task, TaskEvent } from "./types.js";
import { EventEmitter } from "node:events";
import { Firestore, FieldValue } from "@google-cloud/firestore";

export type TaskUpdate = Partial<Omit<Task, "id" | "createdAt" | "events">>;

export interface TaskStore {
  create(task: Task): Promise<void>;
  get(id: string): Promise<Task | undefined>;
  update(id: string, upd: TaskUpdate): Promise<Task>;
  appendEvent(id: string, event: TaskEvent): Promise<void>;
  watch(id: string, onChange: (task: Task) => void): () => void;
}

export class FirestoreStore implements TaskStore {
  private col;
  constructor() {
    const db = new Firestore({ ignoreUndefinedProperties: true });
    this.col = db.collection("tasks");
  }
  async create(task: Task) {
    await this.col.doc(task.id).create(task); // throws
  }
  async get(id: string) {
    const snap = await this.col.doc(id).get();
    return snap.exists ? (snap.data() as Task) : undefined;
  }
  async update(id: string, upd: Task) {
    const ref = this.col.doc(id);
    await ref.update(upd);
    const snap = await ref.get();
    return snap.data() as Task;
  }
  async appendEvent(id: string, event: TaskEvent) {
    await this.col.doc(id).update({ events: FieldValue.arrayUnion(event) });
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
    const updTask = { ...task, ...upd };
    this.tasks.set(id, updTask);
    this.changes.emit(id, structuredClone(updTask));
    return structuredClone(updTask);
  }

  async appendEvent(id: string, event: TaskEvent) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`task ${id} not found`);
    task.events.push(structuredClone(event));
    this.changes.emit(id, structuredClone(task));
  }

  watch(id: string, onChange: (task: Task) => void): () => void {
    this.changes.on(id, onChange);
    const task = this.tasks.get(id);
    // get client up to speed
    if (task) onChange(structuredClone(task));
    return () => this.changes.off(id, onChange);
  }
}
