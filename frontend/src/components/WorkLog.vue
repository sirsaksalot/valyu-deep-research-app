<script setup lang="ts">
import { computed, ref } from "vue";
import { IS_TERMINAL, type Task, type TraceEvent } from "../types";
import { duration, money, plural, SCOPE_LABEL } from "../format";
import Icon from "./Icon.vue";

const props = defineProps<{ task: Task; now: number; runningCost: number }>();

type Item = { kind: "round"; round: number } | { kind: "event"; event: TraceEvent };

const terminal = computed(() => IS_TERMINAL[props.task.status]);

// events in order, with a "Round N" marker whenever the round changes
// (only search/reflect events carry a meaningful round)
const items = computed(() => {
  const out: Item[] = [];
  let round = 0;
  for (const e of [...props.task.events].sort((a, b) => a.id - b.id)) {
    if ((e.type === "search" || e.type === "reflect") && e.round !== round) {
      round = e.round;
      out.push({ kind: "round", round });
    }
    out.push({ kind: "event", event: e });
  }
  return out;
});

// a finished log folds into one summary line; failed ones start open (the log explains the failure).
// steering messages stay visible either way.
const toggled = ref<boolean | null>(null);
const open = computed(() => toggled.value ?? props.task.status === "failed");
const shown = computed(() =>
  !terminal.value || open.value
    ? items.value
    : items.value.filter((i) => i.kind === "event" && i.event.type === "user"),
);

const summary = computed(() => {
  const events = props.task.events;
  const searches = events.filter((e) => e.type === "search");
  const rounds = new Set(searches.map((e) => e.round)).size;
  const verb = { failed: "Failed after", cancelled: "Stopped after" }[props.task.status as string] ?? "Worked for";
  return [
    `${verb} ${duration(props.task.startedAt, props.task.finishedAt)}`,
    plural(searches.length, "search", "searches"),
    plural(rounds, "round"),
    money(props.task.cost.total),
  ].join(" · ");
});

// only reflect rows expand (to show the notes, gaps and follow-ups)
const openReflect = ref<number | null>(null);
const toggle = (id: number) => (openReflect.value = openReflect.value === id ? null : id);

const elapsed = computed(() => duration(props.task.startedAt, null, props.now));
</script>

<template>
  <section class="worklog">
    <button
      v-if="terminal && task.events.length"
      class="worklog-summary"
      :class="{ open, failed: task.status === 'failed' }"
      :aria-expanded="open"
      @click="toggled = !open"
    >
      <Icon name="chevron" class="chev" />
      <span>{{ summary }}</span>
    </button>

    <ol class="rows" :class="{ nested: terminal }">
      <template v-for="(it, i) in shown" :key="it.kind === 'round' ? `r${i}` : it.event.id">
        <li v-if="it.kind === 'round'" class="round-sep"><span>Round {{ it.round }}</span></li>

        <li v-else-if="it.event.type === 'user'" class="msg user">
          <div class="bubble">{{ it.event.text }}</div>
          <div class="msg-meta">Steered during research</div>
        </li>

        <li v-else-if="it.event.type === 'reflect'" class="row-item reflect" :class="{ open: openReflect === it.event.id }">
          <button class="row" :aria-expanded="openReflect === it.event.id" @click="toggle(it.event.id)">
            <Icon name="reflect" class="row-icon" />
            <span class="row-text">
              <b>Reflected</b>
              <template v-if="it.event.done"> · enough evidence, moving on to writing</template>
              <template v-else> · {{ plural(it.event.gaps.length, "gap") }} · {{ plural(it.event.followUps.length, "follow-up") }}</template>
            </span>
            <span class="row-cost">{{ money(it.event.cost) }}</span>
            <Icon name="chevron" class="chev" />
          </button>
          <div v-if="openReflect === it.event.id" class="row-detail">
            <p class="notes">{{ it.event.notes }}</p>
            <template v-if="it.event.gaps.length">
              <div class="detail-label">Still missing</div>
              <ul class="gaps"><li v-for="(g, j) in it.event.gaps" :key="j">{{ g }}</li></ul>
            </template>
            <template v-if="it.event.followUps.length">
              <div class="detail-label">Follow-up searches</div>
              <ul class="calls">
                <li v-for="(c, j) in it.event.followUps" :key="j">
                  <span class="scope" :class="c.scope">{{ SCOPE_LABEL[c.scope] }}</span>
                  <span class="q">{{ c.query }}</span>
                </li>
              </ul>
            </template>
          </div>
        </li>

        <li v-else class="row-item" :class="[it.event.type, { failed: it.event.type === 'search' && it.event.error }]">
          <div class="row static">
            <template v-if="it.event.type === 'plan'">
              <Icon name="plan" class="row-icon" />
              <span class="row-text"><b>Planned</b> {{ plural(it.event.calls.length, "search", "searches") }}</span>
            </template>
            <template v-else-if="it.event.type === 'search'">
              <Icon :name="it.event.error ? 'alert' : 'search'" class="row-icon" />
              <span class="row-text">
                <b>Searched {{ SCOPE_LABEL[it.event.scope] }}</b>
                <span class="sep">·</span>
                <span class="q">“{{ it.event.query }}”</span>
              </span>
              <span class="row-stat">
                <template v-if="it.event.error">failed: {{ it.event.error }}</template>
                <template v-else>{{ it.event.found }} found, {{ it.event.newSources }} new</template>
              </span>
            </template>
            <template v-else-if="it.event.type === 'write'">
              <Icon name="write" class="row-icon" />
              <span class="row-text">
                <b>Wrote report</b> · {{ plural(it.event.cited, "source") }} cited
                <template v-if="it.event.claimsDropped"> · {{ plural(it.event.claimsDropped, "claim") }} dropped</template>
              </span>
            </template>
            <template v-else-if="it.event.type === 'error'">
              <Icon name="alert" class="row-icon" />
              <span class="row-text"><b>{{ it.event.step }} failed</b> · {{ it.event.message }}</span>
            </template>
            <template v-else-if="it.event.type === 'status'">
              <Icon name="clock" class="row-icon" />
              <span class="row-text">{{ it.event.message }}</span>
            </template>
            <span v-if="'cost' in it.event" class="row-cost">{{ money(it.event.cost) }}</span>
            <span class="chev-space" />
          </div>
        </li>
      </template>

      <li v-if="!terminal" class="row-item live">
        <div class="row static">
          <span class="spinner" />
          <span class="row-text shimmer">
            {{ task.status === "queued" ? "Queued…" : task.status === "cancelling" ? "Stopping at the next safe point…" : "Working…" }}
          </span>
          <span v-if="task.status === 'running'" class="row-stat mono">{{ elapsed }}</span>
          <span v-if="task.status === 'running'" class="row-cost">{{ money(runningCost) }}</span>
          <span class="chev-space" />
        </div>
      </li>
    </ol>
  </section>
</template>
