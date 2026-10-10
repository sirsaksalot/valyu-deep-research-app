<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { accessCode, api } from "../api";
import { closeCodeDialog, codeDialog } from "../access";

const code = ref("");
const checking = ref(false);
const error = ref("");
const input = ref<HTMLInputElement | null>(null);

watch(
  () => codeDialog.open,
  async (open) => {
    if (!open) return;
    code.value = "";
    error.value = codeDialog.error;
    await nextTick();
    input.value?.focus();
  },
);

async function unlock() {
  const c = code.value.trim();
  if (!c) return;
  checking.value = true;
  const ok = await api.checkCode(c);
  checking.value = false;
  if (!ok) {
    error.value = "That code didn't work.";
    return;
  }
  accessCode.set(c);
  closeCodeDialog(true);
}
</script>

<template>
  <div v-if="codeDialog.open" class="backdrop" @click.self="closeCodeDialog(false)">
    <form class="dialog" @submit.prevent="unlock">
      <h2>Access code</h2>
      <p class="muted">This app is private. Enter the access code you were given.</p>
      <input ref="input" v-model="code" type="password" autocomplete="off" placeholder="Access code" />
      <p v-if="error" class="form-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" @click="closeCodeDialog(false)">Cancel</button>
        <button class="primary" :disabled="checking || !code.trim()">
          {{ checking ? "Checking…" : "Unlock" }}
        </button>
      </div>
    </form>
  </div>
</template>
