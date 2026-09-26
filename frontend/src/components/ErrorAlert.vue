<script setup>
defineProps({
  error: { type: Object, default: null },
});
</script>

<template>
  <div v-if="error" class="alert error">
    <strong>{{ error.message || '操作失败' }}</strong>
    <ul v-if="error.details && error.details.length">
      <li v-for="(detail, i) in error.details" :key="i">
        <code v-if="detail.path">{{ detail.path }}</code>：{{ detail.message }}
      </li>
    </ul>
  </div>
</template>
