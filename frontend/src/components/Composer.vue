<script setup lang="ts">
import { ref } from "vue";
import Icon from "./Icon.vue";

const props = defineProps<{
  placeholder: string;
  busy?: boolean;
  disabled?: boolean;
  stoppable?: boolean;
}>();
const emit = defineEmits<{ send: []; stop: [] }>();
const draft = defineModel<string>({ required: true });
const box = ref<HTMLTextAreaElement | null>(null);

function send() {
  if (props.busy || props.disabled || !draft.value.trim()) return;
  emit("send");
}
function onEnter(e: KeyboardEvent) {
  if (e.shiftKey || e.isComposing) return;
  e.preventDefault();
  send();
}

defineExpose({ focus: () => box.value?.focus() });
</script>

<template>
  <form class="composer" :class="{ disabled }" @submit.prevent="send">
    <textarea
      ref="box"
      v-model="draft"
      rows="3"
      maxlength="1000"
      :placeholder="placeholder"
      :disabled="disabled"
      @keydown.enter="onEnter"
    />
    <div class="composer-bar">
      <button
        v-if="stoppable"
        type="button"
        class="stop-btn"
        :disabled="busy"
        @click="emit('stop')"
      >
        <Icon name="stop" :size="12" /> Stop
      </button>
      <button
        class="send-btn"
        aria-label="Send"
        :disabled="busy || disabled || !draft.trim()"
      >
        <span v-if="busy" class="spinner on-accent" />
        <Icon v-else name="send" :size="16" />
      </button>
    </div>
  </form>
</template>
