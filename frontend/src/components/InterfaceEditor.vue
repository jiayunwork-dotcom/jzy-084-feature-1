<script setup>
import { ref, computed } from 'vue';
import SchemaEditor from './SchemaEditor.vue';
import ScenarioEditor from './ScenarioEditor.vue';
import MockPreview from './MockPreview.vue';
import { createEmptyInterface } from './schema-factory.js';
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

function resetForm() {
  editingId.value = null;
  form.value = createEmptyInterface();
  refreshStructure();
}

function edit(api) {
  editingId.value = api.id;
  form.value = {
    name: api.name,
    path: api.path,
    method: api.method,
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
      defaultResponse: form.value.defaultResponse,
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

function submit() {
  emit('save-interface', {
    id: editingId.value,
    payload: {
      name: form.value.name,
      path: form.value.path,
      method: form.value.method,
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

      <h3>默认响应体字段结构（无条件命中时返回）</h3>
      <SchemaEditor
        :fields="form.defaultResponse.fields"
        :models="models"
        @update:fields="form.defaultResponse.fields = $event; refreshStructure()"
      />

      <h3>条件响应场景</h3>
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
