<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ApiError, api } from "../api";
import { withAccess } from "../access";
import { IS_TERMINAL, type Task } from "../types";
import { money, STATUS_LABEL } from "../format";
import Icon from "./Icon.vue";
import WorkLog from "./WorkLog.vue";
import Composer from "./Composer.vue";
import ReportView from "./ReportView.vue";
import SourcesView from "./SourcesView.vue";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ update: [task: Task] }>();

const task = ref<Task | null>(null);
const loadError = ref("");

function setTask(t: Task) {
  task.value = t;
  emit("update", t);
}

let stopWatching = () => {};
let tick: number | undefined;
const now = ref(Date.now());

onMounted(async () => {
  try {
    setTask(await api.get(props.id));
  } catch (err) {
    loadError.value =
      err instanceof ApiError && err.status === 404
        ? "This task doesn't exist (any more)."
        : err instanceof Error
          ? err.message
          : String(err);
    return;
  }
  if (!IS_TERMINAL[task.value!.status]) {
    stopWatching = api.watch(props.id, setTask);
  }
  tick = window.setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => {
  stopWatching();
  clearInterval(tick);
});

const terminal = computed(() => !!task.value && IS_TERMINAL[task.value.status]);

const cost = computed(() => {
  const t = task.value;
  if (!t) return { search: 0, llm: 0, total: 0 };
  if (IS_TERMINAL[t.status]) return t.cost;
  let search = 0;
  let llm = 0;
  for (const e of t.events) {
    if (!("cost" in e)) continue;
    if (e.type === "search") search += e.cost;
    else llm += e.cost;
  }
  return { search, llm, total: search + llm };
});

const draft = ref("");
const busy = ref(false);
const actionError = ref("");

const pendingMessages = computed(() => {
  const t = task.value;
  if (!t) return [];
  const read = t.events.filter((e) => e.type === "user").length;
  return t.messages.slice(read);
});

async function act(fn: () => Promise<unknown>) {
  busy.value = true;
  actionError.value = "";
  try {
    await withAccess(fn);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

const send = () =>
  act(async () => {
    const text = draft.value.trim();
    if (!text) return;
    await api.steer(props.id, text);
    draft.value = "";
  });
const stop = () => act(() => api.cancel(props.id));
</script>

<template>
  <div v-if="loadError" class="task-layout">
    <section class="thread-col">
      <div class="thread">
        <p class="form-error">{{ loadError }}</p>
      </div>
    </section>
  </div>

  <div v-else-if="!task" class="task-layout">
    <section class="thread-col">
      <div class="thread"><p class="muted">Loading…</p></div>
    </section>
  </div>

  <div v-else class="task-layout">
    <section class="thread-col">
      <header class="thread-head">
        <span class="status-pill" :class="task.status">
          {{ STATUS_LABEL[task.status] }}
        </span>
        <span class="thread-title" :title="task.prompt">{{ task.prompt }}</span>
      </header>

      <div class="thread-scroll">
        <div class="thread">
          <div class="msg user">
            <div class="bubble">{{ task.prompt }}</div>
          </div>

          <WorkLog :task="task" :now="now" :running-cost="cost.total" />

          <!-- the answer -->
          <div v-if="task.status === 'completed'" class="msg assistant">
            <details class="artifact" open>
              <summary>
                <span class="artifact-icon"
                  ><Icon name="report" :size="16"
                /></span>
                <span class="artifact-name">Report</span>
                <Icon name="chevron" class="chev" />
              </summary>
              <div class="artifact-content"><ReportView :task="task" /></div>
            </details>
            <details class="artifact">
              <summary>
                <span class="artifact-icon"
                  ><Icon name="sources" :size="16"
                /></span>
                <span class="artifact-name"
                  >Sources ({{ task.sources.length }})</span
                >
                <Icon name="chevron" class="chev" />
              </summary>
              <div class="artifact-content"><SourcesView :task="task" /></div>
            </details>
            <details class="artifact">
              <summary>
                <span class="artifact-icon"
                  ><Icon name="json" :size="16"
                /></span>
                <span class="artifact-name">Raw task JSON</span>
                <Icon name="chevron" class="chev" />
              </summary>
              <pre class="artifact-content raw-json">{{
                JSON.stringify(task, null, 2)
              }}</pre>
            </details>
          </div>

          <div v-else-if="task.status === 'failed'" class="msg assistant">
            <div class="callout error">
              <Icon name="alert" :size="16" />
              <div>
                <strong>Research failed</strong>
                <p>{{ task.error?.message ?? "Unknown error." }}</p>
                <p class="dim small">
                  The work log above shows the step that failed. Spend up to
                  that point ({{ money(cost.total) }}) is still recorded.
                </p>
              </div>
            </div>
            <details class="artifact">
              <summary>
                <span class="artifact-icon"
                  ><Icon name="json" :size="16"
                /></span>
                <span class="artifact-name">Raw task JSON</span>
                <Icon name="chevron" class="chev" />
              </summary>
              <pre class="artifact-content raw-json">{{
                JSON.stringify(task, null, 2)
              }}</pre>
            </details>
          </div>

          <div v-else-if="task.status === 'cancelled'" class="msg assistant">
            <div class="callout neutral">
              <Icon name="ban" :size="16" />
              <div>
                <strong>Cancelled</strong>
                <p>
                  The agent stopped at the next safe point, so no report was
                  written.
                </p>
              </div>
            </div>
          </div>

          <div
            v-for="m in terminal ? [] : pendingMessages"
            :key="m.id"
            class="msg user pending"
          >
            <div class="bubble">{{ m.text }}</div>
            <div class="msg-meta">Waiting for the agent's next step…</div>
          </div>
        </div>
      </div>

      <div v-if="!terminal" class="composer-wrap">
        <Composer
          v-model="draft"
          :placeholder="
            task.status === 'cancelling' ? 'Stopping…' : 'Steer this research…'
          "
          :busy="busy"
          :disabled="task.status === 'cancelling'"
          :stoppable="task.status === 'queued' || task.status === 'running'"
          @send="send"
          @stop="stop"
        />
        <p v-if="actionError" class="form-error">{{ actionError }}</p>
      </div>
    </section>
  </div>
</template>
