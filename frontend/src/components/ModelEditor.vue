<script setup>
import { ref } from 'vue';
import SchemaEditor from './SchemaEditor.vue';
import { createField } from './schema-factory.js';

const props = defineProps({
  models: { type: Array, required: true },
});

const emit = defineEmits(['save-model', 'delete-model']);

const editingId = ref(null);
const form = ref({ name: '', fields: [createField('string')] });
const structureJson = ref('');

function resetForm() {
  editingId.value = null;
  form.value = { name: '', fields: [createField('string')] };
  structureJson.value = '';
}

function edit(model) {
  editingId.value = model.id;
  form.value = {
    name: model.name,
    fields: JSON.parse(JSON.stringify(model.fields || [])),
  };
  refreshStructure();
}

function refreshStructure() {
  structureJson.value = JSON.stringify(
    { name: form.value.name, fields: form.value.fields },
    null,
    2,
  );
}

function submit() {
  emit('save-model', {
    id: editingId.value,
    payload: { name: form.value.name, fields: form.value.fields },
  });
}

function onSaved(savedId) {
  editingId.value = savedId;
  refreshStructure();
}

function remove() {
  if (window.confirm(`确认删除模型「${form.value.name}」？被引用时后端会拒绝。`)) {
    emit('delete-model', editingId.value);
  }
}

defineExpose({ resetForm, onSaved });
</script>

<template>
  <div>
    <div class="panel" style="margin-bottom:16px;">
      <h2>公共模型</h2>
      <p class="muted">模型可被任意接口或其它模型引用；保存时自动检测循环引用并指出成环的模型。</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button
          v-for="model in models"
          :key="model.id"
          type="button"
          :class="{ active: editingId === model.id }"
          @click="edit(model)"
        >
          {{ model.name }}
        </button>
        <div v-if="models.length === 0" class="muted" style="padding:6px 0;">还没有模型</div>
        <button type="button" @click="resetForm">+ 新建模型</button>
      </div>
    </div>

    <div class="panel">
      <h2>{{ editingId ? '编辑模型' : '新建模型' }}</h2>
      <div class="form-row">
        <div>
          <label>模型名称（同项目内唯一）</label>
          <input type="text" v-model="form.name" placeholder="如 User / Address" @input="refreshStructure" />
        </div>
      </div>

      <h3>字段结构</h3>
      <SchemaEditor
        :fields="form.fields"
        :models="models.filter((m) => m.id !== editingId)"
        @update:fields="form.fields = $event; refreshStructure()"
      />

      <div style="margin-top:16px; display:flex; gap:10px;">
        <button type="button" class="primary" @click="submit">
          {{ editingId ? '保存修改' : '保存模型' }}
        </button>
        <button v-if="editingId" type="button" class="danger" @click="remove">删除模型</button>
        <button type="button" @click="resetForm">清空表单</button>
      </div>

      <h3>当前结构预览（保存前即时可见）</h3>
      <pre class="structure-view">{{ structureJson || '填写后自动生成…' }}</pre>
    </div>
  </div>
</template>
