<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, callMock } from '../api/client.js';

/**
 * Collection console: fire real list/get/create/replace/patch/delete
 * requests at a resource collection and watch the stored content actually
 * change. Reset restores the initial seed batch.
 */

const collections = ref([]);
const selectedKey = ref('');
const loading = ref(false);
const error = ref('');
const notice = ref('');

// operation state
const operation = ref('list');
const page = ref(1);
const pageSize = ref(20);
const filterField = ref('');
const filterValue = ref('');
const recordId = ref('');
const bodyText = ref('{\n  \n}');
const result = ref(null);
const listResult = ref(null);

const selected = computed(
  () => collections.value.find((c) => c.collectionKey === selectedKey.value) || null,
);

const endpoints = computed(() => {
  const ifs = selected.value?.interfaces || [];
  const byMethod = (method, withParam) =>
    ifs.find((apiDef) => apiDef.method === method && apiDef.path.includes(':') === withParam);
  return {
    list: byMethod('GET', false),
    detail: byMethod('GET', true),
    create: byMethod('POST', false),
    replace: byMethod('PUT', true),
    patch: byMethod('PATCH', true),
    delete: byMethod('DELETE', true),
  };
});

const OPERATIONS = [
  { key: 'list', label: '取列表', needs: 'list' },
  { key: 'detail', label: '取详情', needs: 'detail' },
  { key: 'create', label: '新建', needs: 'create' },
  { key: 'replace', label: '整体替换', needs: 'replace' },
  { key: 'patch', label: '局部修改', needs: 'patch' },
  { key: 'delete', label: '删除', needs: 'delete' },
];

const operationAvailable = computed(() => {
  const op = OPERATIONS.find((o) => o.key === operation.value);
  return op ? Boolean(endpoints.value[op.needs]) : false;
});

const needsId = computed(() => ['detail', 'replace', 'patch', 'delete'].includes(operation.value));
const needsBody = computed(() => ['create', 'replace', 'patch'].includes(operation.value));

function withId(pathTemplate) {
  return pathTemplate.replace(/:[^/]+$/, encodeURIComponent(recordId.value.trim()));
}

async function refreshCollections(keepSelection = true) {
  collections.value = await api.listCollections();
  if (!keepSelection || !collections.value.some((c) => c.collectionKey === selectedKey.value)) {
    selectedKey.value = collections.value[0]?.collectionKey || '';
  }
}

async function refreshList() {
  if (!endpoints.value.list) {
    listResult.value = null;
    return;
  }
  const res = await callMock('GET', endpoints.value.list.path, { query: 'pageSize=100' });
  listResult.value = res;
}

async function select(key) {
  selectedKey.value = key;
  result.value = null;
  error.value = '';
  operation.value = 'list';
  await refreshList();
}

async function run() {
  error.value = '';
  result.value = null;
  loading.value = true;
  try {
    const eps = endpoints.value;
    let res;
    if (operation.value === 'list') {
      const params = new URLSearchParams();
      params.set('page', String(page.value || 1));
      params.set('pageSize', String(pageSize.value || 20));
      if (filterField.value.trim()) params.set(filterField.value.trim(), filterValue.value);
      res = await callMock('GET', eps.list.path, { query: params.toString() });
    } else if (operation.value === 'detail') {
      res = await callMock('GET', withId(eps.detail.path));
    } else if (operation.value === 'create') {
      res = await callMock('POST', eps.create.path, { body: parseBody() });
    } else if (operation.value === 'replace') {
      res = await callMock('PUT', withId(eps.replace.path), { body: parseBody() });
    } else if (operation.value === 'patch') {
      res = await callMock('PATCH', withId(eps.patch.path), { body: parseBody() });
    } else if (operation.value === 'delete') {
      res = await callMock('DELETE', withId(eps.delete.path));
    }
    result.value = res;
    // 写操作之后自动刷新列表，让变化直观可见
    if (['create', 'replace', 'patch', 'delete'].includes(operation.value)) {
      await Promise.all([refreshList(), refreshCollections()]);
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function parseBody() {
  const text = bodyText.value.trim();
  if (!text) return '{}';
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    throw new Error('请求体必须是合法 JSON 对象');
  }
}

async function reset() {
  if (!selectedKey.value) return;
  if (!window.confirm(`确认把集合「${selectedKey.value}」恢复到初始种子状态？当前改动将丢失。`)) return;
  error.value = '';
  notice.value = '';
  try {
    const res = await api.resetCollection(selectedKey.value);
    notice.value = `已恢复初始状态（${res.recordCount} 条种子记录）`;
    result.value = null;
    await Promise.all([refreshList(), refreshCollections()]);
  } catch (err) {
    error.value = err.payload?.error?.message || err.message;
  }
}

function pretty(data) {
  return JSON.stringify(data, null, 2);
}

onMounted(async () => {
  try {
    await refreshCollections(false);
    if (selectedKey.value) await refreshList();
  } catch (err) {
    error.value = `加载集合失败：${err.message}`;
  }
});
</script>

<template>
  <div>
    <div class="panel" style="margin-bottom:16px;">
      <h2>资源集合</h2>
      <div v-if="collections.length === 0" class="muted">
        还没有资源集合。在「接口定义」里把接口形态设为「资源集合」并保存一组 CRUD 端点后，这里就能操作它。
      </div>
      <div v-else style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button
          v-for="c in collections"
          :key="c.collectionKey"
          type="button"
          :class="{ active: selectedKey === c.collectionKey }"
          @click="select(c.collectionKey)"
        >
          {{ c.collectionKey }}
          <span class="muted">
            （{{ c.seeded ? `${c.recordCount} 条` : '未种子' }}）
          </span>
        </button>
      </div>
    </div>

    <template v-if="selected">
      <div class="panel" style="margin-bottom:16px;">
        <h2>集合「{{ selected.collectionKey }}」</h2>
        <p class="muted" style="margin-top:0;line-height:1.7;">
          标识字段：<strong>{{ selected.idField }}</strong> ·
          种子记录数：{{ selected.seedCount }} ·
          状态：{{ selected.seeded ? `已种子（当前 ${selected.recordCount} 条，下一个 id 序号 ${selected.nextSeq}）` : '尚未种子（首次访问时自动生成）' }}
        </p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          <span v-for="ep in selected.interfaces" :key="ep.id" class="badge" :class="`method-${ep.method}`">
            {{ ep.method }} {{ ep.path }}
          </span>
        </div>
        <button type="button" class="danger" @click="reset">一键恢复初始种子状态</button>
        <span v-if="notice" class="muted" style="margin-left:10px;">{{ notice }}</span>
      </div>

      <div class="panel" style="margin-bottom:16px;">
        <h2>对集合发起请求</h2>
        <div class="op-switch">
          <button
            v-for="op in OPERATIONS"
            :key="op.key"
            type="button"
            :class="{ active: operation === op.key }"
            :disabled="!endpoints[op.needs]"
            :title="endpoints[op.needs] ? '' : '该集合未定义此操作对应的端点'"
            @click="operation = op.key; result = null; error = ''"
          >{{ op.label }}</button>
        </div>

        <div v-if="!operationAvailable" class="alert error">
          集合「{{ selected.collectionKey }}」没有定义支持「{{ OPERATIONS.find(o => o.key === operation)?.label }}」的端点。
        </div>

        <template v-else>
          <div v-if="operation === 'list'" class="form-row">
            <div class="narrow">
              <label>页码 page</label>
              <input type="number" min="1" v-model.number="page" />
            </div>
            <div class="narrow">
              <label>每页 pageSize</label>
              <input type="number" min="1" max="100" v-model.number="pageSize" />
            </div>
            <div>
              <label>过滤字段（可选，按记录字段等值过滤）</label>
              <input type="text" v-model="filterField" placeholder="如 status" />
            </div>
            <div>
              <label>过滤值</label>
              <input type="text" v-model="filterValue" placeholder="如 on_sale" />
            </div>
          </div>

          <div v-if="needsId" class="form-row">
            <div class="narrow">
              <label>记录 {{ selected.idField }}</label>
              <input type="text" v-model="recordId" placeholder="如 3" />
            </div>
          </div>

          <div v-if="needsBody" class="form-row">
            <div>
              <label>请求体（JSON；未提供的字段按记录结构生成补齐）</label>
              <textarea v-model="bodyText" rows="4" placeholder='{"contactName":"张三"}'></textarea>
            </div>
          </div>

          <button
            type="button"
            class="primary"
            :disabled="loading || (needsId && !recordId.trim())"
            @click="run"
          >{{ loading ? '请求中…' : '发送请求' }}</button>
        </template>

        <div v-if="error" class="alert error" style="margin-top:12px;">{{ error }}</div>

        <div v-if="result" style="margin-top:14px;">
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
            <span class="badge" :style="{ background: result.status < 400 ? '#dcfce7' : '#fee2e2' }">
              HTTP {{ result.status }}
            </span>
            <span class="muted">{{ result.elapsed }} ms</span>
          </div>
          <pre class="mock-preview">{{ pretty(result.data) }}</pre>
        </div>
      </div>

      <div class="panel">
        <h2>当前集合内容（写操作后自动刷新）</h2>
        <div v-if="listResult" style="margin-bottom:8px;">
          <span class="badge">共 {{ listResult.data?.total ?? '?' }} 条</span>
        </div>
        <pre v-if="listResult" class="mock-preview">{{ pretty(listResult.data?.list ?? listResult.data) }}</pre>
        <div v-else class="muted">该集合未定义列表端点（GET 集合路径），无法展示当前内容。</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.op-switch {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
</style>
