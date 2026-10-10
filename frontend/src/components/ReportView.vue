<script setup lang="ts">
import { computed } from "vue";
import type { Task } from "../types";
import { renderMarkdown } from "../markdown";

const props = defineProps<{ task: Task }>();
const html = computed(() => (props.task.report ? renderMarkdown(props.task.report, props.task.sources) : ""));
</script>

<template>
  <article v-if="html" class="report" v-html="html" />
  <p v-else-if="task.status === 'failed'" class="muted">No report: the research failed before writing.</p>
  <p v-else-if="task.status === 'cancelled'" class="muted">No report: the research was cancelled.</p>
  <p v-else class="muted">The report appears here when the research finishes. Follow along in the thread.</p>
</template>
