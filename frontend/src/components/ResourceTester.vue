<script setup>
import { ref, computed } from 'vue';
import { callMock } from '../api/client.js';

/**
 * Resource operation panel: fires real list/detail/create/update/delete
 * requests against a stateful resource collection and surfaces the response.
 * Emits `changed` after any write so the live collection view can refresh.
 */
const props = defineProps({
  api: { type: Object, required: true },
});
const emit = defineEmits(['changed']);

const queryText = ref('');
const detailId = ref('');
const createBody = ref('{\n  "title": "新建一条"\n}');
const updateId = ref('');
const updateBody = ref('{\n  "title": "改个名字"\n}');
const updateMode = ref('PATCH');
const deleteId = ref('');
const last = ref(null);
const error = ref('');
const loading = ref(false);

const basePath = computed(() => props.api.path);

async function run(label, fn) {
  loading.value = true;
  error.value = '';
  last.value = null;
  try {
    const result = await fn();
    last.value = { label, ...result };
    emit('changed');
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function parseBody(text) {
  if (!text || !text.trim()) return {};
  return JSON.parse(text);
}

const list = () => run('取列表 GET', () =>
  callMock('GET', basePath.value, { query: queryText.value }));

const detail = () => run('取详情 GET /:id', () =>
  callMock('GET', `${basePath.value}/${encodeURIComponent(detailId.value)}`));

const create = () => run('新建 POST', () =>
  callMock('POST', basePath.value, { body: JSON.stringify(parseBody(createBody.value)) }));

const update = () => run(`${updateMode.value} /:id`, () =>
  callMock(updateMode.value, `${basePath.value}/${encodeURIComponent(updateId.value)}`, {
    body: JSON.stringify(parseBody(updateBody.value)),
  }));

const remove = () => run('删除 DELETE /:id', () =>
  callMock('DELETE', `${basePath.value}/${encodeURIComponent(deleteId.value)}`));

function pretty(data) {
  if (data === null || data === undefined) return '（无响应体，204 No Content）';
  return JSON.stringify(data, null, 2);
}
</script>

<template>
  <div class="panel">
    <h2>集合操作（真实读写，结果随操作累积变化）</h2>

    <div class="op-block">
      <div class="op-title"><span class="badge method-GET">GET</span> 取列表（翻页 / 过滤）</div>
      <div class="field-row">
        <input type="text" v-model="queryText" placeholder="查询串：page=1&pageSize=10&category=tech" />
        <button type="button" class="primary" :disabled="loading" @click="list">取列表</button>
      </div>
    </div>

    <div class="op-block">
      <div class="op-title"><span class="badge method-GET">GET</span> 按 id 取详情</div>
      <div class="field-row">
        <input type="text" v-model="detailId" placeholder="记录 id" />
        <button type="button" class="primary" :disabled="loading" @click="detail">取详情</button>
      </div>
    </div>

    <div class="op-block">
      <div class="op-title"><span class="badge method-POST">POST</span> 新建（缺的字段自动补齐，id 由平台分配）</div>
      <textarea v-model="createBody" rows="3"></textarea>
      <div style="margin-top:6px;">
        <button type="button" class="primary" :disabled="loading" @click="create">新建一条</button>
      </div>
    </div>

    <div class="op-block">
      <div class="op-title">
        <select v-model="updateMode" style="width:110px;">
          <option value="PATCH">PATCH</option>
          <option value="PUT">PUT</option>
        </select>
        更新（PATCH 局部改 / PUT 整体替换）
      </div>
      <div class="field-row">
        <input type="text" v-model="updateId" placeholder="目标记录 id" />
      </div>
      <textarea v-model="updateBody" rows="3"></textarea>
      <div style="margin-top:6px;">
        <button type="button" class="primary" :disabled="loading" @click="update">执行更新</button>
      </div>
    </div>

    <div class="op-block">
      <div class="op-title"><span class="badge method-DELETE">DELETE</span> 按 id 删除</div>
      <div class="field-row">
        <input type="text" v-model="deleteId" placeholder="目标记录 id" />
        <button type="button" class="danger" :disabled="loading" @click="remove">删除</button>
      </div>
    </div>

    <div v-if="error" class="alert error" style="margin-top:12px;">{{ error }}</div>

    <div v-if="last" style="margin-top:14px;">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
        <strong>{{ last.label }}</strong>
        <span class="badge" :style="{ background: last.status < 400 ? '#dcfce7' : '#fee2e2' }">
          HTTP {{ last.status }}
        </span>
        <span v-if="last.location" class="muted">Location: {{ last.location }}</span>
        <span class="muted">{{ last.elapsed }} ms</span>
      </div>
      <pre class="mock-preview">{{ pretty(last.data) }}</pre>
    </div>
  </div>
</template>
