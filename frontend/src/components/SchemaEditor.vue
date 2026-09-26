<script setup>
import { FIELD_TYPES, createField, uid } from './schema-factory.js';

const props = defineProps({
  fields: { type: Array, required: true },
  models: { type: Array, default: () => [] },
  depth: { type: Number, default: 0 },
});

const emit = defineEmits(['update:fields']);

function update(index, patch) {
  const next = [...props.fields];
  next[index] = { ...next[index], ...patch };
  emit('update:fields', next);
}

function remove(index) {
  const next = props.fields.filter((_, i) => i !== index);
  emit('update:fields', next);
}

function add() {
  emit('update:fields', [...props.fields, createField('string')]);
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= props.fields.length) return;
  const next = [...props.fields];
  [next[index], next[target]] = [next[target], next[index]];
  emit('update:fields', next);
}

function onTypeChange(field, index, type) {
  // Preserve name/id across type switches; seed type-specific defaults.
  const replacement = { ...createField(type), id: field.id, name: field.name };
  update(index, replacement);
}

function addEnumValue(field, index) {
  update(index, { values: [...(field.values || []), ''] });
}

function updateEnumValue(field, index, valueIndex, value) {
  const values = [...(field.values || [])];
  values[valueIndex] = value;
  update(index, { values });
}

function removeEnumValue(field, index, valueIndex) {
  const values = (field.values || []).filter((_, i) => i !== valueIndex);
  update(index, { values });
}
</script>

<template>
  <div>
    <div v-for="(field, index) in fields" :key="field.id">
      <div class="field-row">
        <button
          type="button"
          class="small"
          title="上移（影响 JSON 字段顺序）"
          :disabled="index === 0"
          @click="move(index, -1)"
        >↑</button>
        <button
          type="button"
          class="small"
          title="下移"
          :disabled="index === fields.length - 1"
          @click="move(index, 1)"
        >↓</button>
        <input
          class="field-name"
          type="text"
          v-model="field.name"
          placeholder="字段名，如 email / phone"
          @change="update(index, { name: field.name })"
        />
        <select
          class="field-type"
          :value="field.type"
          @change="onTypeChange(field, index, $event.target.value)"
        >
          <option v-for="t in FIELD_TYPES" :key="t.value" :value="t.value">
            {{ t.label }}
          </option>
        </select>

        <div class="field-extra">
          <template v-if="field.type === 'number'">
            <input type="number" v-model.number="field.min" placeholder="min"
              @change="update(index, { min: field.min })" />
            <span class="muted">~</span>
            <input type="number" v-model.number="field.max" placeholder="max"
              @change="update(index, { max: field.max })" />
            <label style="display:flex;align-items:center;gap:4px;margin:0;white-space:nowrap;">
              <input type="checkbox" v-model="field.float"
                @change="update(index, { float: field.float })" /> 小数
            </label>
          </template>

          <template v-else-if="field.type === 'enum'">
            <span
              v-for="(value, vi) in field.values"
              :key="vi"
              style="display:flex;gap:4px;align-items:center;"
            >
              <input
                type="text"
                :value="value"
                placeholder="候选值"
                @input="updateEnumValue(field, index, vi, $event.target.value)"
              />
              <button type="button" class="small danger" @click="removeEnumValue(field, index, vi)">×</button>
            </span>
            <button type="button" class="small" @click="addEnumValue(field, index)">+ 候选值</button>
          </template>

          <template v-else-if="field.type === 'ref'">
            <select :value="field.ref" @change="update(index, { ref: $event.target.value })">
              <option value="" disabled>选择公共模型…</option>
              <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </template>

          <template v-else-if="field.type === 'string'">
            <span class="muted">按字段名自动推测内容</span>
          </template>
        </div>

        <button type="button" class="small danger" @click="remove(index)">删除</button>
      </div>

      <div v-if="field.type === 'object'" class="field-tree">
        <SchemaEditor
          :fields="field.fields"
          :models="models"
          :depth="depth + 1"
          @update:fields="update(index, { fields: $event })"
        />
      </div>

      <div v-if="field.type === 'array'" class="field-tree">
        <div class="muted" style="margin-bottom:6px;">元素类型（随机生成 1~5 个）：</div>
        <div class="field-row">
          <input
            class="field-name"
            type="text"
            :value="field.items.name"
            placeholder="元素字段名"
            @input="update(index, { items: { ...field.items, name: $event.target.value } })"
          />
          <select
            class="field-type"
            :value="field.items.type"
            @change="update(index, { items: { ...createField($event.target.value), id: field.items.id, name: field.items.name } })"
          >
            <option v-for="t in FIELD_TYPES" :key="t.value" :value="t.value">
              {{ t.label }}
            </option>
          </select>
          <template v-if="field.items.type === 'ref'">
            <div class="field-extra">
              <select
                :value="field.items.ref"
                @change="update(index, { items: { ...field.items, ref: $event.target.value } })"
              >
                <option value="" disabled>选择公共模型…</option>
                <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
              </select>
            </div>
          </template>
        </div>
        <SchemaEditor
          v-if="field.items.type === 'object'"
          :fields="field.items.fields"
          :models="models"
          :depth="depth + 1"
          @update:fields="update(index, { items: { ...field.items, fields: $event } })"
        />
      </div>
    </div>

    <button type="button" class="small" @click="add">+ 添加字段</button>
  </div>
</template>
