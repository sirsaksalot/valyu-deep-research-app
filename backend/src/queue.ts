import { CloudTasksClient } from "@google-cloud/tasks";
import { OAuth2Client } from "google-auth-library";
import { runTask, type WorkerDeps } from "./worker.js";

export type Dispatch = (taskId: string) => Promise<void>;

export const inProcessDispatch =
  (deps: WorkerDeps): Dispatch =>
  async (taskId) => {
    void runTask(taskId, deps).catch((err) =>
      console.error(`task ${taskId} runner failed`, err),
    );
  };

export function cloudTasksDispatch(): Dispatch {
  const project = need("GOOGLE_CLOUD_PROJECT");
  const location = need("TASKS_LOCATION");
  const queue = need("TASKS_QUEUE");
  const workerUrl = need("WORKER_URL");
  const serviceAccountEmail = need("TASKS_SA");
  const client = new CloudTasksClient();
  const parent = client.queuePath(project, location, queue);

  return async (taskId) => {
    await client.createTask({
      parent,
      task: {
        // dedupes
        name: `${parent}/tasks/${taskId}`,
        dispatchDeadline: { seconds: 15 * 60 },
        httpRequest: {
          httpMethod: "POST",
          url: `${workerUrl}/internal/run/${taskId}`,
          oidcToken: { serviceAccountEmail, audience: workerUrl },
        },
      },
    });
  };
}

export function cloudTasksVerifier() {
  const audience = process.env.WORKER_URL;
  const email = process.env.TASKS_SA;
  const client = new OAuth2Client();
  return async (authorization: string | undefined): Promise<boolean> => {
    if (!audience || !email) return false;
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return false;
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience });
      const payload = ticket.getPayload();
      return payload?.email === email && payload.email_verified === true;
    } catch {
      return false;
    }
  };
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
