<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { IS_TERMINAL, type TaskSummary } from "../types";
import { money, relativeTime, STATUS_LABEL, STATUS_ICON } from "../format";

defineProps<{
  tasks: TaskSummary[];
  selectedId: string | null;
  error: string;
}>();
defineEmits<{ select: [id: string] }>();

const now = ref(Date.now());
let tick: number | undefined;
onMounted(
  () => (tick = window.setInterval(() => (now.value = Date.now()), 60_000)),
);
onUnmounted(() => clearInterval(tick));
</script>

<template>
  <nav class="task-list">
    <p v-if="error" class="list-error">{{ error }}</p>
    <p v-else-if="tasks.length === 0" class="muted small">No research yet.</p>
    <button
      v-for="t in tasks"
      :key="t.id"
      class="task-row"
      :class="{ selected: t.id === selectedId }"
      :title="t.prompt"
      @click="$emit('select', t.id)"
    >
      <span v-if="!IS_TERMINAL[t.status]" class="status-icon"
        ><span class="spinner"
      /></span>
      <span v-else class="status-icon" :class="t.status">{{
        STATUS_ICON[t.status]
      }}</span>
      <span class="task-row-body">
        <span class="task-row-title">
          {{ t.prompt }}
        </span>
        <span class="task-row-meta">
          <template v-if="!IS_TERMINAL[t.status]"
            >{{ STATUS_LABEL[t.status] }}…</template
          >
          <template v-else>{{ relativeTime(t.updatedAt, now) }}</template>
          <template v-if="t.cost.total > 0">
            · {{ money(t.cost.total) }}</template
          >
        </span>
      </span>
    </button>
  </nav>
</template>
