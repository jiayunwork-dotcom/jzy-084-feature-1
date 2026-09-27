<script setup>
import { ref, computed } from 'vue';
import SchemaEditor from './SchemaEditor.vue';
import ScenarioEditor from './ScenarioEditor.vue';
import MockPreview from './MockPreview.vue';
import CollectionConfigEditor from './CollectionConfigEditor.vue';
import { createEmptyInterface, createEmptyCollectionConfig } from './schema-factory.js';
import { METHODS } from './schema-factory.js';

const props = defineProps({
  interfaces: { type: Array, required: true },
  models: { type: Array, required: true },
});

const emit = defineEmits(['save-interface', 'delete-interface']);

const editingId = ref(null);
const form = ref(createEmptyInterface());
const saveVersion = ref(0);
const structureView = ref('');

const methodBadge = computed(() => `method-${form.value.method}`);
const isCollection = computed(() => form.value.kind === 'collection');

function resetForm() {
  editingId.value = null;
  form.value = createEmptyInterface();
  refreshStructure();
}

function edit(api) {
  editingId.value = api.id;
  const collection = api.collection
    ? {
        collectionKey: api.collection.collectionKey,
        idField: api.collection.idField || 'id',
        seedCount: api.collection.seedCount ?? 5,
        recordSource: api.collection.record?.type === 'ref' ? 'ref' : 'inline',
        record: JSON.parse(JSON.stringify(api.collection.record)),
      }
    : createEmptyCollectionConfig();
  form.value = {
    name: api.name,
    path: api.path,
    method: api.method,
    kind: api.kind || 'stateless',
    collection,
    defaultResponse: JSON.parse(JSON.stringify(api.defaultResponse || { fields: [] })),
    scenarios: JSON.parse(JSON.stringify(api.scenarios || [])),
  };
  refreshStructure();
}

function refreshStructure() {
  structureView.value = JSON.stringify(
    {
      name: form.value.name,
      path: form.value.path,
      method: form.value.method,
      kind: form.value.kind,
      ...(isCollection.value
        ? { collection: collectionPayload() }
        : {
            defaultResponse: form.value.defaultResponse,
          }),
      scenarios: form.value.scenarios.map((s) => ({
        name: s.name,
        conditions: s.conditions,
        statusCode: s.statusCode,
      })),
    },
    null,
    2,
  );
}

/** Strip UI-only state (recordSource) from the collection config. */
function collectionPayload() {
  const c = form.value.collection;
  return {
    collectionKey: c.collectionKey,
    idField: c.idField || 'id',
    seedCount: c.seedCount,
    record:
      c.recordSource === 'ref'
        ? { type: 'ref', ref: c.record.ref || '' }
        : { type: 'object', fields: c.record.fields || [] },
  };
}

function submit() {
  emit('save-interface', {
    id: editingId.value,
    payload: {
      name: form.value.name,
      path: form.value.path,
      method: form.value.method,
      kind: form.value.kind,
      collection: isCollection.value ? collectionPayload() : undefined,
      defaultResponse: isCollection.value ? { fields: [] } : form.value.defaultResponse,
      scenarios: form.value.scenarios,
    },
  });
}

function onSaved(savedId) {
  editingId.value = savedId;
  saveVersion.value += 1;
  refreshStructure();
}

function remove() {
  if (window.confirm(`确认删除接口「${form.value.name}」？`)) {
    emit('delete-interface', editingId.value);
  }
}

defineExpose({ resetForm, onSaved });
</script>

<template>
  <div>
    <div class="panel" style="margin-bottom:16px;">
      <h2>接口列表</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button
          v-for="api in interfaces"
          :key="api.id"
          type="button"
          :class="{ active: editingId === api.id }"
          @click="edit(api)"
        >
          <span class="badge" :class="`method-${api.method}`">{{ api.method }}</span>
          {{ api.path }}
          <span v-if="api.kind === 'collection'" class="badge badge-collection">集合</span>
          <span class="muted">（{{ api.name }}）</span>
        </button>
        <div v-if="interfaces.length === 0" class="muted" style="padding:6px 0;">还没有接口</div>
        <button type="button" @click="resetForm">+ 新建接口</button>
      </div>
    </div>

    <div class="panel">
      <h2>{{ editingId ? '编辑接口' : '新建接口' }}</h2>
      <div class="form-row">
        <div class="narrow">
          <label>请求方法</label>
          <select v-model="form.method" @change="refreshStructure()">
            <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <div>
          <label>请求路径（以 / 开头，不允许 //）</label>
          <input type="text" v-model="form.path" placeholder="/api/users/:id" @input="refreshStructure" />
        </div>
        <div>
          <label>接口名称</label>
          <input type="text" v-model="form.name" placeholder="如 用户列表" @input="refreshStructure" />
        </div>
      </div>

      <div class="form-row">
        <div>
          <label>接口形态</label>
          <div class="kind-switch">
            <button
              type="button"
              :class="{ active: form.kind === 'stateless' }"
              @click="form.kind = 'stateless'; refreshStructure()"
            >普通接口（每次现生成）</button>
            <button
              type="button"
              :class="{ active: form.kind === 'collection' }"
              @click="form.kind = 'collection'; refreshStructure()"
            >资源集合（有状态增删改查）</button>
          </div>
          <p v-if="isCollection" class="muted" style="margin:8px 0 0;line-height:1.6;">
            集合语义：GET 集合路径=列表（page/pageSize/字段过滤），GET .../:id=详情，
            POST=新建，PUT=整体替换，PATCH=局部修改，DELETE=删除；
            同一路径上的场景命中时优先返回场景响应。
          </p>
        </div>
      </div>

      <template v-if="isCollection">
        <h3>资源集合配置</h3>
        <CollectionConfigEditor
          :collection="form.collection"
          :models="models"
          @changed="refreshStructure"
        />
      </template>

      <template v-else>
        <h3>默认响应体字段结构（无条件命中时返回）</h3>
        <SchemaEditor
          :fields="form.defaultResponse.fields"
          :models="models"
          @update:fields="form.defaultResponse.fields = $event; refreshStructure()"
        />
      </template>

      <h3>条件响应场景</h3>
      <p v-if="isCollection" class="muted" style="margin-top:0;">
        集合接口上，场景命中时<strong>优先</strong>返回场景静态响应（不触碰集合数据）；未命中才执行集合读写。
      </p>
      <ScenarioEditor
        :scenarios="form.scenarios"
        :models="models"
        @update:scenarios="form.scenarios = $event; refreshStructure()"
      />

      <div style="margin-top:16px;display:flex;gap:10px;">
        <button type="button" class="primary" @click="submit">
          {{ editingId ? '保存修改' : '保存接口' }}
        </button>
        <button v-if="editingId" type="button" class="danger" @click="remove">删除接口</button>
        <button type="button" @click="resetForm">清空表单</button>
      </div>

      <h3>当前定义预览（保存前即时可见）</h3>
      <pre class="structure-view">{{ structureView }}</pre>
    </div>

    <MockPreview
      v-if="editingId"
      :key="editingId"
      :method="form.method"
      :path="form.path"
      :version="saveVersion"
    />
    <div v-else class="panel muted">保存接口后，即可在此处一键请求生成的 Mock 端点。</div>
  </div>
</template>

<style scoped>
.kind-switch {
  display: flex;
  gap: 8px;
}
.badge-collection {
  background: #dbeafe;
  color: #1d4ed8;
  margin-left: 4px;
}
</style>
