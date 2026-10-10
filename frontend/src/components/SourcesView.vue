<script setup lang="ts">
import type { Task } from "../types";
import { authorList, cleanAbstract, providerLabel, year } from "../format";

defineProps<{ task: Task }>();
</script>

<template>
  <div>
    <p v-if="task.sources.length === 0" class="muted">No sources were cited.</p>

    <ol class="sources">
      <li v-for="s in task.sources" :key="s.id" class="source">
        <span class="source-n">{{ s.n }}</span>
        <div class="source-body">
          <a :href="s.url" target="_blank" rel="noopener noreferrer" class="source-title">{{ s.title }}</a>
          <div class="source-meta">
            <span v-if="s.authors?.length">{{ authorList(s.authors) }}</span>
            <span>{{ year(s.publicationDate) }}</span>
            <span class="provider">{{ providerLabel(s.provider) }}</span>
            <span v-if="s.sourceType">{{ s.sourceType }}</span>
            <span v-if="s.citationCount">{{ s.citationCount }} citations</span>
            <a v-if="s.doi" :href="`https://doi.org/${s.doi}`" target="_blank" rel="noopener noreferrer">doi:{{ s.doi }}</a>
          </div>
          <p v-if="s.abstract || s.excerpts[0]" class="source-abstract">
            {{ cleanAbstract(s.abstract || s.excerpts[0] || "") }}
          </p>
        </div>
      </li>
    </ol>
  </div>
</template>
