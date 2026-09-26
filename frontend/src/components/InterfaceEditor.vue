<script setup>
import { ref, computed } from 'vue';
import SchemaEditor from './SchemaEditor.vue';
import ScenarioEditor from './ScenarioEditor.vue';
import MockPreview from './MockPreview.vue';
import { createEmptyInterface, createEmptyResource, METHODS } from './schema-factory.js';

const props = defineProps({
  interfaces: { type: Array, required: true },
  models: { type: Array, required: true },
});

const emit = defineEmits(['save-interface', 'delete-interface', 'edit-resource']);

const editingId = ref(null);
const form = ref(createEmptyInterface());
const saveVersion = ref(0);
const structureView = ref('');

const isResource = computed(() => form.value.kind === 'resource');
const editingApi = computed(() => props.interfaces.find((api) => api.id === editingId.value) || null);
const methodBadge = computed(() => `method-${form.value.method}`);

function resetForm(kind = 'standard') {
  editingId.value = null;
  form.value = kind === 'resource' ? createEmptyResource() : createEmptyInterface();
  refreshStructure();
}

function edit(api) {
  editingId.value = api.id;
  if ((api.kind || 'standard') === 'resource') {
    const config = api.resourceConfig || { fields: [], seedCount: 5, idField: 'id', pageSize: 10 };
    form.value = {
      name: api.name,
      path: api.path,
      method: api.method,
      kind: 'resource',
      resourceConfig: {
        fields: JSON.parse(JSON.stringify(config.fields || [])),
        seedCount: config.seedCount ?? 5,
        idField: config.idField || 'id',
        pageSize: config.pageSize ?? 10,
      },
      scenarios: JSON.parse(JSON.stringify(api.scenarios || [])),
    };
  } else {
    form.value = {
      name: api.name,
      path: api.path,
      method: api.method,
      kind: 'standard',
      defaultResponse: JSON.parse(JSON.stringify(api.defaultResponse || { fields: [] })),
      scenarios: JSON.parse(JSON.stringify(api.scenarios || [])),
    };
  }
  refreshStructure();
}

function switchKind(kind) {
  // Preserve name/path when switching; swap the body definition entirely.
  const { name, path } = form.value;
  form.value = kind === 'resource'
    ? { ...createEmptyResource(), name, path }
    : { ...createEmptyInterface(), name, path };
  refreshStructure();
}

function refreshStructure() {
  const view = isResource.value
    ? {
        kind: 'resource',
        name: form.value.name,
        path: form.value.path,
        resourceConfig: form.value.resourceConfig,
        scenarios: form.value.scenarios.map((s) => ({
          name: s.name,
          conditions: s.conditions,
          statusCode: s.statusCode,
        })),
      }
    : {
        kind: 'standard',
        name: form.value.name,
        path: form.value.path,
        method: form.value.method,
        defaultResponse: form.value.defaultResponse,
        scenarios: form.value.scenarios.map((s) => ({
          name: s.name,
          conditions: s.conditions,
          statusCode: s.statusCode,
        })),
      };
  structureView.value = JSON.stringify(view, null, 2);
}

function submit() {
  if (isResource.value) {
    emit('save-interface', {
      id: editingId.value,
      payload: {
        name: form.value.name,
        path: form.value.path,
        method: 'GET',
        kind: 'resource',
        resourceConfig: form.value.resourceConfig,
        scenarios: form.value.scenarios,
      },
    });
    return;
  }
  emit('save-interface', {
    id: editingId.value,
    payload: {
      name: form.value.name,
      path: form.value.path,
      method: form.value.method,
      kind: 'standard',
      defaultResponse: form.value.defaultResponse,
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

function openResourceConsole() {
  if (editingId.value) emit('edit-resource', editingId.value);
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
          <span v-if="(api.kind || 'standard') === 'resource'" class="badge" style="background:#fef3c7;color:#92400e;">
            资源集合
          </span>
          <span v-else class="badge" :class="`method-${api.method}`">{{ api.method }}</span>
          {{ api.path }}
          <span class="muted">（{{ api.name }}）</span>
        </button>
        <div v-if="interfaces.length === 0" class="muted" style="padding:6px 0;">还没有接口</div>
        <button type="button" @click="resetForm('standard')">+ 新建普通接口</button>
        <button type="button" @click="resetForm('resource')">+ 新建资源集合</button>
      </div>
    </div>

    <div class="panel">
      <h2>{{ editingId ? '编辑接口' : '新建接口' }}</h2>

      <div class="kind-switch">
        <button
          type="button"
          :class="{ active: !isResource }"
          @click="switchKind('standard')"
        >普通接口（每次请求现生成）</button>
        <button
          type="button"
          :class="{ active: isResource }"
          @click="switchKind('resource')"
        >资源集合（有状态、可增删改查）</button>
      </div>

      <div class="form-row">
        <div v-if="!isResource" class="narrow">
          <label>请求方法</label>
          <select v-model="form.method" @change="refreshStructure()">
            <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <div>
          <label :class="{ strong: isResource }">
            {{ isResource ? '集合基础路径（静态路径，平台自动接管 该路径 与 该路径/:id）' : '请求路径（以 / 开头，不允许 //）' }}
          </label>
          <input type="text" v-model="form.path" :placeholder="isResource ? '/api/articles' : '/api/users/:id'" @input="refreshStructure" />
        </div>
        <div>
          <label>接口名称</label>
          <input type="text" v-model="form.name" placeholder="如 用户列表" @input="refreshStructure" />
        </div>
      </div>

      <template v-if="isResource">
        <p class="muted" style="margin:6px 0 12px;">
          平台在启动/首次访问时按下面的记录结构用同一套假数据生成器预先种入固定记录；
          之后同一路径上的 <code>GET</code> 列表（支持 page/pageSize 翻页、按字段精确过滤）、
          <code>GET /:id</code> 详情、<code>POST</code> 新建、<code>PUT</code>/<code>PATCH /:id</code> 更新、
          <code>DELETE /:id</code> 删除都会真实读写这份集合。配置的条件场景优先于集合读写。
        </p>

        <div class="form-row">
          <div class="narrow">
            <label>初始记录数（0~100）</label>
            <input type="number" min="0" max="100" v-model.number="form.resourceConfig.seedCount"
              @change="refreshStructure()" />
          </div>
          <div class="narrow">
            <label>标识字段名</label>
            <input type="text" v-model="form.resourceConfig.idField" @input="refreshStructure" />
          </div>
          <div class="narrow">
            <label>默认每页条数</label>
            <input type="number" min="1" max="100" v-model.number="form.resourceConfig.pageSize"
              @change="refreshStructure()" />
          </div>
        </div>

        <h3>集合记录字段结构（可引用公共模型，多层引用照样展开）</h3>
        <SchemaEditor
          :fields="form.resourceConfig.fields"
          :models="models"
          @update:fields="form.resourceConfig.fields = $event; refreshStructure()"
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

      <h3>条件响应场景{{ isResource ? '（可选；命中时优先于集合读写）' : '' }}</h3>
      <ScenarioEditor
        :scenarios="form.scenarios"
        :models="models"
        @update:scenarios="form.scenarios = $event; refreshStructure()"
      />

      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <button type="button" class="primary" @click="submit">
          {{ editingId ? '保存修改' : '保存接口' }}
        </button>
        <button v-if="editingId" type="button" class="danger" @click="remove">删除接口</button>
        <button type="button" @click="resetForm(isResource ? 'resource' : 'standard')">清空表单</button>
        <button v-if="editingId && isResource" type="button" @click="openResourceConsole">
          打开资源集合联调台 →
        </button>
      </div>

      <h3>当前定义预览（保存前即时可见）</h3>
      <pre class="structure-view">{{ structureView }}</pre>
    </div>

    <MockPreview
      v-if="editingId && !isResource"
      :key="editingId"
      :method="form.method"
      :path="form.path"
      :version="saveVersion"
    />
    <div v-else-if="!editingId" class="panel muted">保存接口后，即可在此处一键请求生成的 Mock 端点。</div>
    <div v-else class="panel muted">
      资源集合已保存 —— 请到「资源集合」标签页对它发起列表 / 详情 / 新建 / 更新 / 删除操作。
    </div>
  </div>
</template>
