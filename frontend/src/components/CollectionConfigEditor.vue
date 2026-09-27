<script setup>
import SchemaEditor from './SchemaEditor.vue';
import { createField } from './schema-factory.js';

/**
 * Editor for the collection config of a resource-collection interface:
 * which collection it belongs to (collectionKey), the id field, seed count,
 * and the record shape (public-model reference or inline fields).
 */
const props = defineProps({
  collection: { type: Object, required: true },
  models: { type: Array, default: () => [] },
});

const emit = defineEmits(['changed']);

function patch(data) {
  Object.assign(props.collection, data);
  emit('changed');
}

function switchRecordSource(source) {
  const record =
    source === 'ref'
      ? { type: 'ref', ref: '' }
      : { type: 'object', fields: [createField('string')] };
  patch({ recordSource: source, record });
}

function updateRecordFields(fields) {
  patch({ record: { type: 'object', fields } });
}
</script>

<template>
  <div class="collection-config">
    <div class="form-row">
      <div>
        <label>集合标识 collectionKey（同标识的接口共享一份集合数据）</label>
        <input
          type="text"
          :value="collection.collectionKey"
          placeholder="如 users / orders"
          @input="patch({ collectionKey: $event.target.value })"
        />
      </div>
      <div class="narrow">
        <label>标识字段名</label>
        <input
          type="text"
          :value="collection.idField"
          placeholder="id"
          @input="patch({ idField: $event.target.value })"
        />
      </div>
      <div class="narrow">
        <label>种子记录数（0~50）</label>
        <input
          type="number"
          min="0"
          max="50"
          :value="collection.seedCount"
          @input="patch({ seedCount: Number($event.target.value) })"
        />
      </div>
    </div>

    <label>记录结构（集合里每条记录的形态）</label>
    <div class="record-source">
      <button
        type="button"
        :class="{ active: collection.recordSource === 'ref' }"
        @click="switchRecordSource('ref')"
      >引用公共模型</button>
      <button
        type="button"
        :class="{ active: collection.recordSource === 'inline' }"
        @click="switchRecordSource('inline')"
      >就地定义字段</button>
    </div>

    <div v-if="collection.recordSource === 'ref'" class="form-row">
      <div>
        <select
          :value="collection.record.ref"
          @change="patch({ record: { type: 'ref', ref: $event.target.value } })"
        >
          <option value="" disabled>选择作为记录结构的公共模型…</option>
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
        <p class="muted" style="margin:6px 0 0;">
          多层模型引用照常递归展开；公共模型的循环引用检测对集合同样生效。
        </p>
      </div>
    </div>
    <SchemaEditor
      v-else
      :fields="collection.record.fields"
      :models="models"
      @update:fields="updateRecordFields"
    />
  </div>
</template>

<style scoped>
.collection-config {
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  padding: 12px;
  background: #f8fafc;
}
.record-source {
  display: flex;
  gap: 8px;
  margin: 6px 0 10px;
}
</style>
