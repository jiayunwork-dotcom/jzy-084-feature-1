<script setup>
import SchemaEditor from './SchemaEditor.vue';
import { createField, uid } from './schema-factory.js';

const props = defineProps({
  scenarios: { type: Array, required: true },
  models: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:scenarios']);

const LOCATIONS = [
  { value: 'query', label: '查询参数 query' },
  { value: 'header', label: '请求头 header' },
  { value: 'body', label: '请求体 body' },
];
const OPERATORS = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'exists', label: '存在' },
  { value: 'not_exists', label: '不存在' },
];

function patch(index, patchData) {
  const next = [...props.scenarios];
  next[index] = { ...next[index], ...patchData };
  emit('update:scenarios', next);
}

function remove(index) {
  emit('update:scenarios', props.scenarios.filter((_, i) => i !== index));
}

function add() {
  emit('update:scenarios', [
    ...props.scenarios,
    {
      id: uid('sc'),
      name: `场景 ${props.scenarios.length + 1}`,
      statusCode: 200,
      conditions: [{ id: uid('c'), location: 'query', field: '', operator: 'eq', value: '' }],
      response: { fields: [createField('string')] },
    },
  ]);
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= props.scenarios.length) return;
  const next = [...props.scenarios];
  [next[index], next[target]] = [next[target], next[index]];
  emit('update:scenarios', next);
}

function addCondition(scenario, index) {
  patch(index, {
    conditions: [
      ...scenario.conditions,
      { id: uid('c'), location: 'query', field: '', operator: 'eq', value: '' },
    ],
  });
}

function patchCondition(scenario, index, condIndex, data) {
  const conditions = scenario.conditions.map((c, i) => (i === condIndex ? { ...c, ...data } : c));
  patch(index, { conditions });
}

function removeCondition(scenario, index, condIndex) {
  patch(index, { conditions: scenario.conditions.filter((_, i) => i !== condIndex) });
}
</script>

<template>
  <div>
    <p class="muted">
      场景按<strong>从上到下的顺序</strong>依次匹配（靠前优先级最高），同一请求命中第一套后立即生效；
      每套场景内的多个条件之间是「且」的关系。都不命中时使用默认响应。
    </p>

    <div v-for="(scenario, index) in scenarios" :key="scenario.id" class="scenario-card">
      <div class="scenario-head">
        <span class="priority-tag">优先级 {{ index + 1 }}</span>
        <button type="button" class="small" :disabled="index === 0" @click="move(index, -1)">上移</button>
        <button type="button" class="small" :disabled="index === scenarios.length - 1" @click="move(index, 1)">下移</button>
        <input
          type="text"
          :value="scenario.name"
          placeholder="场景名称，如 VIP 用户"
          @input="patch(index, { name: $event.target.value })"
          style="flex:1;"
        />
        <label style="margin:0;display:flex;align-items:center;gap:6px;white-space:nowrap;">
          状态码
          <input
            type="number"
            :value="scenario.statusCode"
            style="width:90px;"
            @input="patch(index, { statusCode: Number($event.target.value) })"
          />
        </label>
        <button type="button" class="small danger" @click="remove(index)">删除场景</button>
      </div>

      <h3 style="margin-top:4px;">匹配条件（全部满足才命中）</h3>
      <div
        v-for="(condition, ci) in scenario.conditions"
        :key="condition.id"
        class="field-row"
      >
        <select
          class="field-type"
          :value="condition.location"
          @change="patchCondition(scenario, index, ci, { location: $event.target.value })"
        >
          <option v-for="l in LOCATIONS" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
        <input
          class="field-name"
          type="text"
          :value="condition.field"
          placeholder="字段名，如 vip / Authorization"
          @input="patchCondition(scenario, index, ci, { field: $event.target.value })"
        />
        <select
          class="field-type"
          :value="condition.operator"
          @change="patchCondition(scenario, index, ci, { operator: $event.target.value })"
        >
          <option v-for="op in OPERATORS" :key="op.value" :value="op.value">{{ op.label }}</option>
        </select>
        <input
          v-if="!['exists', 'not_exists'].includes(condition.operator)"
          class="field-name"
          type="text"
          :value="condition.value"
          placeholder="期望值"
          @input="patchCondition(scenario, index, ci, { value: $event.target.value })"
        />
        <button type="button" class="small danger" @click="removeCondition(scenario, index, ci)">移除条件</button>
      </div>
      <button type="button" class="small" @click="addCondition(scenario, index)">+ 添加条件</button>

      <h3>该场景的响应体结构</h3>
      <SchemaEditor
        :fields="scenario.response.fields"
        :models="models"
        @update:fields="patch(index, { response: { fields: $event } })"
      />
    </div>

    <button type="button" @click="add">+ 添加响应场景</button>
  </div>
</template>
