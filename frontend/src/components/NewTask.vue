<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import { withAccess } from "../access";
import Composer from "./Composer.vue";

const emit = defineEmits<{ created: [id: string] }>();

const prompt = ref("");
const busy = ref(false);
const error = ref("");
const composer = ref<InstanceType<typeof Composer> | null>(null);
onMounted(() => composer.value?.focus());

async function submit() {
  const text = prompt.value.trim();
  if (!text || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const id = await withAccess(() => api.create(text));
    prompt.value = "";
    emit("created", id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="task-layout">
    <section class="thread-col">
      <div class="thread-scroll">
        <div class="thread empty">
          <p class="empty-prompt">Enter a research question</p>
        </div>
      </div>
      <div class="composer-wrap">
        <Composer
          ref="composer"
          v-model="prompt"
          placeholder="Ask a research question…"
          :busy="busy"
          @send="submit"
        />
        <p v-if="error" class="form-error">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
