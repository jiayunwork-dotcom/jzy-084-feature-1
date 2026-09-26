<script setup>
import { ref, onMounted, watch } from 'vue';
import ResourceTester from './ResourceTester.vue';
import { api, callMock } from '../api/client.js';

/**
 * Resource collection console: pick a collection, watch its live records,
 * reset it to the seed, and run list/detail/create/update/delete requests from
 * the operation panel. Collection interaction lives here — deliberately kept
 * separate from the interface/model definition editors.
 */
const props = defineProps({
  interfaces: { type: Array, required: true },
  selectedId: { type: String, default: null },
});
const emit = defineEmits(['select']);

const currentId = ref(props.selectedId || null);
const liveQuery = ref('');
const listResult = ref(null);
const stateInfo = ref(null);
const loading = ref(false);
const error = ref('');
const resetting = ref(false);

const resources = ref([]);
const current = ref(null);

function syncResources() {
  resources.value = props.interfaces.filter((item) => (item.kind || 'standard') === 'resource');
  if (resources.value.length && !resources.value.some((r) => r.id === currentId.value)) {
    currentId.value = resources.value[0].id;
  }
  current.value = resources.value.find((r) => r.id === currentId.value) || null;
}

watch(() => props.interfaces, syncResources, { deep: false });
watch(() => props.selectedId, (id) => {
  if (id) {
    currentId.value = id;
    syncResources();
  }
});

onMounted(() => {
  syncResources();
  if (current.value) refresh();
});

watch(currentId, () => {
  listResult.value = null;
  stateInfo.value = null;
  liveQuery.value = '';
  if (current.value) refresh();
});

async function refresh() {
  if (!current.value) return;
  loading.value = true;
  error.value = '';
  try {
    const [listRes, stateRes] = await Promise.allSettled([
      callMock('GET', current.value.path, {
        query: liveQuery.value.trim() || `pageSize=${current.value.resourceConfig?.pageSize || 10}`,
      }),
      api.getResourceState(current.value.id),
    ]);
    if (listRes.status === 'fulfilled') listResult.value = listRes.value;
    if (stateRes.status === 'fulfilled') stateInfo.value = stateRes.value;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function gotoPage(page) {
  const params = new URLSearchParams(liveQuery.value.replace(/^\?/, ''));
  params.set('page', String(page));
  liveQuery.value = params.toString();
  refresh();
}

async function resetCollection() {
  if (!current.value) return;
  if (!window.confirm(`把集合「${current.value.name}」恢复到初始种子状态？所有改动都会被清除。`)) return;
  resetting.value = true;
  error.value = '';
  try {
    await api.resetResource(current.value.id);
    await refresh();
  } catch (err) {
    error.value = err.payload?.error?.message || err.message;
  } finally {
    resetting.value = false;
  }
}

function choose(event) {
  currentId.value = event.target.value;
  emit('select', currentId.value);
}

function fieldNames(record) {
  return record && typeof record === 'object' ? Object.keys(record).slice(0, 6) : [];
}
</script>

<template>
  <div>
    <div class="panel">
      <h2>资源集合联调台</h2>
      <p class="muted">
        这里展示集合此刻真实存着的记录；在右侧发起新建 / 更新 / 删除后，列表会立即反映累计状态。
      </p>
      <div class="field-row">
        <select v-if="resources.length" :value="currentId" @change="choose" style="max-width:360px;">
          <option v-for="r in resources" :key="r.id" :value="r.id">
            {{ r.path }}（{{ r.name }}，种子 {{ r.resourceConfig?.seedCount ?? 0 }} 条）
          </option>
        </select>
        <button type="button" class="small" :disabled="!current || loading" @click="refresh">刷新列表</button>
        <button type="button" class="small danger" :disabled="!current || resetting" @click="resetCollection">
          {{ resetting ? '恢复中…' : '一键恢复初始状态' }}
        </button>
        <span v-if="stateInfo" class="muted">
          当前 {{ stateInfo.total }} 条 · 种子 {{ stateInfo.seedCount }} 条 · 下一个 id {{ stateInfo.nextId }}
        </span>
      </div>
      <div v-if="error" class="alert error">{{ error }}</div>
      <div v-if="!resources.length" class="empty-hint">
        还没有资源集合。请先到「接口定义」里新建一个资源集合。
      </div>
    </div>

    <div v-if="current" class="resource-layout">
      <div class="panel collection-live">
        <h2>集合实时内容 · {{ current.path }}</h2>
        <div class="field-row" style="margin-bottom:8px;">
          <input type="text" v-model="liveQuery" placeholder="翻页/过滤：page=2&category=tech"
            @keyup.enter="refresh" style="flex:1;" />
          <button type="button" class="small" @click="refresh">查询</button>
        </div>
        <div v-if="loading" class="muted">加载中…</div>
        <template v-else-if="listResult">
          <div class="muted" style="margin-bottom:8px;">
            第 {{ listResult.data.pagination.page }}/{{ listResult.data.pagination.totalPages }} 页 ·
            共 {{ listResult.data.pagination.total }} 条 · 每页 {{ listResult.data.pagination.pageSize }} 条
          </div>
          <table class="record-table">
            <thead>
              <tr>
                <th style="width:80px;">id</th>
                <th>记录内容</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in listResult.data.data" :key="record[current.resourceConfig.idField || 'id']">
                <td><strong>{{ record[current.resourceConfig.idField || 'id'] }}</strong></td>
                <td><code>{{ JSON.stringify(record) }}</code></td>
              </tr>
            </tbody>
          </table>
          <div v-if="listResult.data.pagination.total === 0" class="muted">集合是空的，新建一条试试。</div>
          <div class="pager">
            <button type="button" class="small"
              :disabled="listResult.data.pagination.page <= 1"
              @click="gotoPage(listResult.data.pagination.page - 1)">上一页</button>
            <button type="button" class="small"
              :disabled="listResult.data.pagination.page >= listResult.data.pagination.totalPages"
              @click="gotoPage(listResult.data.pagination.page + 1)">下一页</button>
            <span class="muted">{{ listResult.data.pagination.page }} / {{ listResult.data.pagination.totalPages }}</span>
          </div>
          <div class="muted" style="margin-top:8px;">
            字段：{{ fieldNames(listResult.data.data[0]).join(', ') || '—' }}
          </div>
        </template>
      </div>

      <ResourceTester :api="current" @changed="refresh" />
    </div>
  </div>
</template>
