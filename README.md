# 接口 Mock 平台

团队内部使用的接口 Mock 平台：在浏览器里用**表单**定义接口结构与条件场景，保存后立即生成可直接请求的 Mock 端点，返回结构合理、字段可信的假数据，让前端在后端就绪前就能联调。

- 前端：Vue 3 + Vite（Node.js 20 打包，nginx 静态分发）
- 后端：Node.js 20 + Express
- 存储：PostgreSQL 16
- 交付：Docker Compose，一条命令启动全部组件

## 一条命令启动

```bash
docker compose up --build
```

启动完成后：

| 用途 | 地址 |
| --- | --- |
| 平台界面（浏览器打开） | http://localhost:8080 |
| 后端管理 API | http://localhost:4000/api |
| Mock 端点前缀 | http://localhost:4000/mock/** |

例如内置演示接口定义了 `GET /api/users`，可直接请求：

```bash
curl 'http://localhost:4000/mock/api/users'                 # 默认响应
curl 'http://localhost:4000/mock/api/users?vip=true'        # 命中「VIP」场景
curl -H 'x-token: admin' 'http://localhost:4000/mock/api/users?vip=true'  # 命中优先级更高的「管理员令牌」场景
```

响应头 `X-Mock-Scenario` 标明本次命中的场景（`default` 表示默认响应）。

## 功能说明

### 字段类型
字符串、数字、布尔、枚举、数组（1~5 个随机元素）、嵌套对象、公共模型引用，全部支持递归生成。

### 字符串按字段名智能推测
| 字段名语义 | 产出内容 |
| --- | --- |
| `userName` / `name` / `contactPerson` | 中文人名 |
| `email` / `userEmail` | 合法邮箱 |
| `phone` / `mobile` / `tel` | 11 位手机号（`1[3-9]xxxxxxxxx`） |
| `address` / `homeAddress` | 省市区道路门牌地址 |
| `website` / `homePage` / `url` | 合法链接 |
| `avatar` / `headImg` | 头像图片链接 |
| `image` / `photo` 等 | 随机图片链接 |
| 识别不出语义 | `mock_xxxxxxxx` 通用随机串 |

### 公共模型与多层引用
公共模型可被任意接口或其它模型引用；「模型引用模型」会逐层递归展开（演示数据中 `User → Company → Address` 为三层引用）。

**循环引用在保存时检测并拒绝**：模型 A 引用 B、B 又引回 A（或经更长链路成环，含自引用）会返回 `CIRCULAR_REFERENCE` 错误，并明确列出成环的模型链路，例如 `LoopA -> LoopB -> LoopA`。

### 条件场景
同一接口可配置多套响应场景：
- 每套场景含若干匹配条件（来源支持 `query` / `header` / `body`，运算符支持 `eq` / `ne` / `contains` / `exists` / `not_exists`），条件之间为「且」；
- **严格按场景声明顺序从上到下判定，命中第一个即生效**，可在界面上调整顺序；
- 都不命中时走默认响应；每套场景可单独指定 HTTP 状态码。

### 保存时校验（结构化错误）
- 路径必须以 `/` 开头，且不允许出现连续 `//`；
- 同一项目内「路径 + 方法」组合唯一；
- 枚举字段必须有候选值；
- 模型引用必须指向已存在的模型；
- 数组必须声明元素类型、对象必须声明子字段；
- 数字字段 `min` 不能大于 `max`。

错误统一为 `422` + 结构化响应：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "定义校验失败",
    "details": [{ "path": "defaultResponse.fields.0", "message": "枚举字段 color 至少需要一个候选值" }]
  }
}
```

### 不做的事（功能边界）
成员邀请与权限分级、接口变更历史与版本回滚、多语言代码生成，均不在本平台范围内。

## 本地开发

```bash
# 1. 起一个 PostgreSQL 16（或使用任何已有实例）
docker run --name mock-pg -e POSTGRES_USER=mock -e POSTGRES_PASSWORD=mock \
  -e POSTGRES_DB=mockplatform -p 5432:5432 -d postgres:16-alpine

# 2. 后端（:4000，自动建表并在首次启动写入演示数据）
cd backend
npm install
npm run dev          # 或 npm test 跑测试

# 3. 前端（:5173，已配置 /api 与 /mock 代理到 4000）
cd ../frontend
npm install
npm run dev
```

## 测试

后端测试（Node 内置 test runner，共 65 个）锁定全部正确性基准：

```bash
cd backend && npm test
```

覆盖点：
- 字段名语义推测 + 生成值格式正确（邮箱字段产出的确实是邮箱格式等）；
- 模型引用多层递归展开、数组内模型引用展开；
- 直接互引、自引用、长链路成环、经数组/嵌套对象成环均被检测；
- 路径合法性（斜杠开头、无双斜杠）与「路径 + 方法」唯一性；
- 枚举无候选值、引用不存在模型等在保存时返回结构化错误；
- 条件场景严格按声明顺序取首个命中、条件间为 AND、头部大小写不敏感；
- 基于内存 PostgreSQL（pg-mem）的完整 HTTP 集成链路：保存定义 → 真实请求 Mock 端点。

## 目录结构

```
backend/
  src/
    db/                  # pg 连接、建表、接口/模型仓储、演示数据
    services/            # 校验、成环检测、唯一性、业务编排
    mock/
      field-inference.js # 字段名 -> 语义类别
      data-generator.js  # 假数据递归生成（独立模块）
      scenario-matcher.js# 条件场景按序匹配（独立模块）
      dispatcher.js      # Mock 请求分发（独立模块，不与生成逻辑混写）
    routes/              # models / interfaces / projects / mock 路由
frontend/
  src/components/
    InterfaceEditor.vue  # 接口编辑
    ModelEditor.vue      # 公共模型编辑
    SchemaEditor.vue     # 递归字段树
    ScenarioEditor.vue   # 条件场景编辑
    MockPreview.vue      # 一键请求 + Mock 结果预览
docker-compose.yml
```
