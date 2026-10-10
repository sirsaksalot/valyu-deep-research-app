import { computed, ref } from "vue";

const hash = ref(location.hash);
window.addEventListener("hashchange", () => (hash.value = location.hash));

export const route = {
  taskId: computed(() => hash.value.match(/^#\/task\/([\w-]+)/)?.[1] ?? null),
};

export function go(id: string | null) {
  location.hash = id ? `#/task/${id}` : "#/";
}
