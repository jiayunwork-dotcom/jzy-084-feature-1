<script setup>
import { ref, onMounted } from 'vue';
import InterfaceEditor from './components/InterfaceEditor.vue';
import ResourceConsole from './components/ResourceConsole.vue';
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
const selectedResourceId = ref(null);

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
    if (payload.kind === 'resource') {
      selectedResourceId.value = saved.id;
      flashSuccess(id ? '资源集合已保存并重新播种' : '资源集合已创建，初始记录已就绪');
    } else {
      flashSuccess(id ? '接口已保存，Mock 端点已更新' : '接口已创建，Mock 端点立即可用');
    }
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

function openResourceConsole(id) {
  selectedResourceId.value = id;
  tab.value = 'resources';
}
</script>

<template>
  <header class="app-header">
    <h1>接口 Mock 平台</h1>
    <span class="subtitle">表单定义接口结构 · 保存即生成可请求的 Mock 端点 · 资源集合支持有状态读写</span>
  </header>

  <div class="layout">
    <nav class="sidebar">
      <button :class="{ active: tab === 'interfaces' }" @click="tab = 'interfaces'">
        接口定义
      </button>
      <button :class="{ active: tab === 'resources' }" @click="tab = 'resources'">
        资源集合
      </button>
      <button :class="{ active: tab === 'models' }" @click="tab = 'models'">
        公共模型
      </button>
      <p class="muted" style="margin-top:24px;line-height:1.6;">
        普通接口每次请求现生成；<br />
        资源集合种入后固定下来，支持列表/详情/新建/更新/删除，写完读得到、删了就没了，可一键恢复初始状态。
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
          @edit-resource="openResourceConsole"
        />
        <ResourceConsole
          v-else-if="tab === 'resources'"
          :interfaces="interfaces"
          :selected-id="selectedResourceId"
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
