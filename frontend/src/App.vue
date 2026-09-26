<script setup>
import { ref, onMounted } from 'vue';
import InterfaceEditor from './components/InterfaceEditor.vue';
import ModelEditor from './components/ModelEditor.vue';
import ErrorAlert from './components/ErrorAlert.vue';
import { api } from './api/client.js';

const tab = ref('interfaces');
const models = ref([]);
const interfaces = ref([]);
const error = ref(null);
const success = ref('');
const loading = ref(true);

const interfaceEditorRef = ref(null);
const modelEditorRef = ref(null);

async function refresh() {
  [models.value, interfaces.value] = await Promise.all([
    api.listModels(),
    api.listInterfaces(),
  ]);
}

onMounted(async () => {
  try {
    await refresh();
  } catch (err) {
    error.value = { message: `加载失败：${err.message}` };
  } finally {
    loading.value = false;
  }
});

function flashSuccess(message) {
  success.value = message;
  setTimeout(() => {
    success.value = '';
  }, 2500);
}

async function onSaveModel({ id, payload }) {
  error.value = null;
  try {
    const saved = id
      ? await api.updateModel(id, payload)
      : await api.createModel(payload);
    await refresh();
    modelEditorRef.value?.onSaved(saved.id);
    flashSuccess(id ? '模型已保存' : '模型已创建');
  } catch (err) {
    error.value = err.payload?.error || { message: err.message };
  }
}

async function onDeleteModel(id) {
  error.value = null;
  try {
    await api.deleteModel(id);
    await refresh();
    modelEditorRef.value?.resetForm();
    flashSuccess('模型已删除');
  } catch (err) {
    error.value = err.payload?.error || { message: err.message };
  }
}

async function onSaveInterface({ id, payload }) {
  error.value = null;
  try {
    const saved = id
      ? await api.updateInterface(id, payload)
      : await api.createInterface(payload);
    await refresh();
    interfaceEditorRef.value?.onSaved(saved.id);
    flashSuccess(id ? '接口已保存，Mock 端点已更新' : '接口已创建，Mock 端点立即可用');
  } catch (err) {
    error.value = err.payload?.error || { message: err.message };
  }
}

async function onDeleteInterface(id) {
  error.value = null;
  try {
    await api.deleteInterface(id);
    await refresh();
    interfaceEditorRef.value?.resetForm();
    flashSuccess('接口已删除');
  } catch (err) {
    error.value = err.payload?.error || { message: err.message };
  }
}
</script>

<template>
  <header class="app-header">
    <h1>接口 Mock 平台</h1>
    <span class="subtitle">表单定义接口结构 · 保存即生成可请求的 Mock 端点</span>
  </header>

  <div class="layout">
    <nav class="sidebar">
      <button :class="{ active: tab === 'interfaces' }" @click="tab = 'interfaces'">
        接口定义
      </button>
      <button :class="{ active: tab === 'models' }" @click="tab = 'models'">
        公共模型
      </button>
      <p class="muted" style="margin-top:24px;line-height:1.6;">
        字符串字段按字段名自动推测：人名、邮箱、手机号、地址、网址、头像；<br />
        数组随机 1~5 个元素并递归生成；<br />
        场景按声明顺序取首个命中。
      </p>
    </nav>

    <main class="main">
      <div v-if="loading" class="muted">加载中…</div>
      <template v-else>
        <div v-if="success" class="alert success">{{ success }}</div>
        <ErrorAlert :error="error" />

        <InterfaceEditor
          v-if="tab === 'interfaces'"
          ref="interfaceEditorRef"
          :interfaces="interfaces"
          :models="models"
          @save-interface="onSaveInterface"
          @delete-interface="onDeleteInterface"
        />
        <ModelEditor
          v-else
          ref="modelEditorRef"
          :models="models"
          @save-model="onSaveModel"
          @delete-model="onDeleteModel"
        />
      </template>
    </main>
  </div>
</template>
