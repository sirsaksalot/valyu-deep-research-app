<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api } from "./api";
import { withAccess } from "./access";
import { IS_TERMINAL, type Task, type TaskSummary } from "./types";
import { go, route } from "./route";
import TaskList from "./components/TaskList.vue";
import NewTask from "./components/NewTask.vue";
import TaskView from "./components/TaskView.vue";
import AccessDialog from "./components/AccessDialog.vue";
import Icon from "./components/Icon.vue";

const { taskId } = route;

const tasks = ref<TaskSummary[]>([]);
const listError = ref("");
const unlocked = ref(false);

async function refresh() {
  try {
    tasks.value = await api.list();
    listError.value = "";
  } catch (err) {
    listError.value = err instanceof Error ? err.message : String(err);
  }
}

let timer: number | undefined;
async function poll() {
  await refresh();
  const busy = tasks.value.some((t) => !IS_TERMINAL[t.status]);
  timer = window.setTimeout(poll, busy ? 4000 : 30000);
}

function onTaskUpdate(task: Task) {
  const i = tasks.value.findIndex((t) => t.id === task.id);
  const row: TaskSummary = {
    id: task.id,
    prompt: task.prompt,
    status: task.status,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    cost: task.cost,
  };
  if (i >= 0) tasks.value[i] = row;
  else tasks.value.unshift(row);
}

async function onCreated(id: string) {
  go(id);
  await refresh();
}

async function unlock() {
  try {
    tasks.value = await withAccess(() => api.list());
    unlocked.value = true;
    void poll();
  } catch (err) {
    listError.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(() => void unlock());
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <div v-if="!unlocked" class="locked">
    <span class="brand"><span class="logo">◆</span> Deep Research</span>
    <p class="muted">{{ listError || "Checking access…" }}</p>
    <button v-if="listError" class="primary" @click="unlock">
      Enter access code
    </button>
    <AccessDialog />
  </div>
  <div v-else class="app">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo">◆</span>
        <span>Deep Research</span>
      </div>
      <button class="new-btn" :class="{ active: !taskId }" @click="go(null)">
        <Icon name="plus" /> New research
      </button>
      <TaskList
        :tasks="tasks"
        :selected-id="taskId"
        :error="listError"
        @select="go"
      />
    </aside>

    <main class="main">
      <TaskView
        v-if="taskId"
        :key="taskId"
        :id="taskId"
        @update="onTaskUpdate"
      />
      <NewTask v-else @created="onCreated" />
    </main>

    <AccessDialog />
  </div>
</template>
