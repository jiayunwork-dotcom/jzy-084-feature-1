<script setup>
import { ref, computed, watch } from 'vue';
import { callMock } from '../api/client.js';

const props = defineProps({
  method: { type: String, default: 'GET' },
  path: { type: String, default: '' },
  /* bump this number to force a fresh "definition changed" state */
  version: { type: Number, default: 0 },
});

const query = ref('');
const headersText = ref('{}');
const bodyText = ref('');
const loading = ref(false);
const error = ref('');
const result = ref(null);

const endpoint = computed(() => {
  const qs = query.value.trim() ? `?${query.value.trim().replace(/^\?/, '')}` : '';
  return `/mock${props.path || ''}${qs}`;
});

watch(
  () => [props.method, props.path, props.version],
  () => {
    result.value = null;
    error.value = '';
  },
);

async function send() {
  loading.value = true;
  error.value = '';
  result.value = null;
  try {
    let headers = {};
    try {
      headers = JSON.parse(headersText.value || '{}');
    } catch {
      throw new Error('请求头必须是合法 JSON 对象，如 {"Authorization":"Bearer abc"}');
    }
    let body = bodyText.value;
    if (body.trim()) {
      try {
        body = JSON.stringify(JSON.parse(body));
      } catch {
        throw new Error('请求体必须是合法 JSON');
      }
    }
    result.value = await callMock(props.method, props.path, {
      query: query.value,
      headers,
      body,
    });
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function pretty(data) {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}
</script>

<template>
  <div class="panel">
    <h2>Mock 端点试请求</h2>
    <div class="muted" style="margin-bottom:10px; word-break:break-all;">
      端点地址：<strong>{{ method }} {{ endpoint }}</strong>
    </div>

    <div class="form-row">
      <div style="flex:2;">
        <label>查询参数（不带问号，如 vip=true&amp;page=1）</label>
        <input type="text" v-model="query" placeholder="vip=true" />
      </div>
    </div>
    <div class="form-row">
      <div style="flex:1;">
        <label>请求头（JSON）</label>
        <input type="text" v-model="headersText" placeholder='{"Authorization":"Bearer abc"}' />
      </div>
    </div>
    <div v-if="!['GET', 'HEAD'].includes(method)" class="form-row">
      <div>
        <label>请求体（JSON）</label>
        <textarea v-model="bodyText" rows="3" placeholder='{"type":"beta"}'></textarea>
      </div>
    </div>

    <button type="button" class="primary" :disabled="loading || !path" @click="send">
      {{ loading ? '请求中…' : '一键请求 Mock 端点' }}
    </button>

    <div v-if="error" class="alert error" style="margin-top:12px;">{{ error }}</div>

    <div v-if="result" style="margin-top:14px;">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
        <span
          class="badge"
          :style="{ background: result.status < 400 ? '#dcfce7' : '#fee2e2' }"
        >HTTP {{ result.status }}</span>
        <span class="badge">命中场景：{{ result.matchedScenario || '默认响应' }}</span>
        <span class="muted">{{ result.elapsed }} ms</span>
      </div>
      <pre class="mock-preview">{{ pretty(result.data) }}</pre>
    </div>
  </div>
</template>
