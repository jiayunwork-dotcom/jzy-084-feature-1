# 接口 Mock 平台

团队内部使用的接口 Mock 平台：在浏览器里用**表单**定义接口结构与条件场景，保存后立即生成可直接请求的 Mock 端点，返回结构合理、字段可信的假数据，让前端在后端就绪前就能联调。

接口有两种形态：

- **普通接口（stateless）**：每次请求按字段结构现生成一份随机响应；
- **资源集合（collection）**：平台为集合预种一批记录并持久化，同一资源路径上的 GET/POST/PUT/PATCH/DELETE 落地成真正对得上的增删改查——写完能读到、改完是新值、删了就没了。

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

内置演示还包含一个**资源集合**「contacts」（6 个 CRUD 端点）：

```bash
curl 'http://localhost:4000/mock/api/contacts'                    # 列表（首次访问自动种入 5 条）
curl -X POST -H 'Content-Type: application/json' \
  -d '{"contactName":"张三"}' 'http://localhost:4000/mock/api/contacts'   # 新建，平台分配 id=6
curl 'http://localhost:4000/mock/api/contacts/6'                  # 按 id 取详情，读到的就是刚建的那条
curl -X PATCH -H 'Content-Type: application/json' \
  -d '{"level":"A"}' 'http://localhost:4000/mock/api/contacts/6'  # 局部修改
curl -X DELETE 'http://localhost:4000/mock/api/contacts/6'        # 删除，再取详情即 404
curl -X POST 'http://localhost:4000/api/collections/contacts/reset'  # 恢复初始种子状态
curl 'http://localhost:4000/mock/api/contacts?simulate=error'     # 命中场景，优先于集合读写
```

## 资源集合（有状态的 Mock 端点）

### 定义方式
在接口编辑里把「接口形态」设为**资源集合**，并配置：

| 配置 | 说明 |
| --- | --- |
| `collectionKey` | 集合标识。**同一项目内 collectionKey 相同的接口共享一份集合数据**（通常就是同一资源路径上的一组 CRUD 端点）；这些接口的记录结构、标识字段、种子数量必须完全一致，否则保存被拒绝 |
| `record` | 每条记录的形态：`ref` 引用公共模型（多层引用照常递归展开），或 `object` 就地定义字段 |
| `idField` | 标识字段名，默认 `id`。该字段由平台管理：新建时分配、之后稳定不变 |
| `seedCount` | 首次访问时预种的记录数（0~50，默认 5） |

种入与补齐用的都是与普通接口**同一套**生成逻辑（按字段名推测语义、按类型递归展开、多层模型引用照样展开），没有第二套假数据生成器。记录一旦生成就固定下来，成为集合此刻真实的内容。

### 集合上的方法语义
| 方法与路径形态 | 语义 |
| --- | --- |
| `GET /path`（无路径参数） | 列表：`?page=&pageSize=` 翻页（默认 1/20，上限 100），其余查询参数若与记录顶层字段同名则按等值过滤；响应为 `{ list, total, page, pageSize }` |
| `GET /path/:id` | 按 id 取单条；不存在时返回 `404` + `RECORD_NOT_FOUND` 结构化错误 |
| `POST /path` | 新建：请求体字段并入记录，未提供的字段按记录结构生成补齐后固定；平台分配单调递增、永不复用的 id；`201` 返回完整记录 |
| `PUT /path/:id` | 整体替换：记录被替换为「请求体 + 缺失字段重新生成」，id 保持不变 |
| `PATCH /path/:id` | 局部修改：只改请求体里出现的字段，其余原样保留 |
| `DELETE /path/:id` | 删除：从集合中真正移除；再取详情得到 `RECORD_NOT_FOUND` |

保存时的路径约束：集合路径最多一个 `:参数` 且必须在末尾；PUT/PATCH/DELETE 必须以 `:参数` 结尾；POST 不允许带路径参数。

### 与条件场景的关系（优先级）
**场景优先**：请求先到场景匹配器，按声明顺序命中第一套场景时，直接返回该场景的静态生成响应，**不触碰集合数据**；所有场景都不命中时，才执行上表的集合读写。普通接口行为不变：场景命中返回场景响应，否则现生成默认响应。

### 一致性保证
- 任意「写—读」序列下，读到的结果如实反映此前所有写操作累计后的状态；
- id 一经分配即稳定，不因其它记录的增删而漂移或串号，已删除记录的 id 不复用；
- 生成一次的字段在未被显式更新时，历次读取完全相同；
- id 分配经单语句原子自增完成，并发写入不会产生重复 id、记录覆盖或计数错乱；
- 集合状态持久化在 PostgreSQL（`collection_states` / `collection_records` 表），平台重启后内容与已分配标识不丢失。

### 恢复初始状态
`POST /api/collections/:collectionKey/reset`（或控制台里的「一键恢复初始种子状态」按钮）把集合恢复到最初种入的那一批记录——种子批次在首次种入时已快照保存，恢复后内容与计数器都回到种子结束处，就像从没被改过一样。

管理接口：`GET /api/collections` 列出所有集合（记录数、下一 id 序号、关联端点），前端「资源集合」标签页基于它提供可视化的取列表/取详情/新建/更新/删除/恢复操作。

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
公共模型可被任意接口、集合记录结构或其它模型引用；「模型引用模型」会逐层递归展开（演示数据中 `User → Company → Address` 为三层引用）。

**循环引用在保存时检测并拒绝**：模型 A 引用 B、B 又引回 A（或经更长链路成环，含自引用）会返回 `CIRCULAR_REFERENCE` 错误，并明确列出成环的模型链路，例如 `LoopA -> LoopB -> LoopA`。集合记录结构引用公共模型时同样受此约束；被集合记录结构引用的模型不可删除。

### 条件场景
同一接口可配置多套响应场景：
- 每套场景含若干匹配条件（来源支持 `query` / `header` / `body`，运算符支持 `eq` / `ne` / `contains` / `exists` / `not_exists`），条件之间为「且」；
- **严格按场景声明顺序从上到下判定，命中第一个即生效**，可在界面上调整顺序；
- 都不命中时走默认响应（普通接口）或集合读写（资源集合接口）；每套场景可单独指定 HTTP 状态码。

### 保存时校验（结构化错误）
- 路径必须以 `/` 开头，且不允许出现连续 `//`；
- 同一项目内「路径 + 方法」组合唯一；
- 枚举字段必须有候选值；
- 模型引用必须指向已存在的模型；
- 数组必须声明元素类型、对象必须声明子字段；
- 数字字段 `min` 不能大于 `max`；
- 资源集合：`collectionKey` 必填且合法、记录结构必须是 object/ref、种子数 0~50、路径参数形态与方法匹配、同 `collectionKey` 的接口定义必须一致。

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

后端测试（Node 内置 test runner，共 107 个）锁定全部正确性基准：

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
- **资源集合**：混合写读序列最终状态正确、两次列表一致、分页与过滤、详情/新建/替换/局部修改/删除语义、id 稳定且不复用、生成一次字段历次读取一致、并发新建与混合并发写不产生重复 id 或记录覆盖、恢复初始状态回到种子批次、场景优先于集合读写、集合状态跨应用实例持久化、同 collectionKey 定义一致性、被集合引用的模型删除保护；
- 基于内存 PostgreSQL（pg-mem）的完整 HTTP 集成链路：保存定义 → 真实请求 Mock 端点。

## 目录结构

```
backend/
  src/
    db/                  # pg 连接、建表、接口/模型/集合仓储、演示数据
    services/            # 校验、成环检测、唯一性、集合管理、业务编排
    mock/
      field-inference.js # 字段名 -> 语义类别
      data-generator.js  # 假数据递归生成（独立模块）
      scenario-matcher.js# 条件场景按序匹配（独立模块）
      collection-engine.js # 集合读写语义：列表/详情/新建/更新/删除（独立模块）
      dispatcher.js      # Mock 请求分发：场景优先，其次集合/无状态分流
    routes/              # models / interfaces / projects / collections / mock 路由
frontend/
  src/components/
    InterfaceEditor.vue  # 接口编辑（含形态切换）
    CollectionConfigEditor.vue # 资源集合配置（记录结构/标识/种子数）
    CollectionConsole.vue# 资源集合控制台（CRUD 试请求 + 一键恢复）
    ModelEditor.vue      # 公共模型编辑
    SchemaEditor.vue     # 递归字段树
    ScenarioEditor.vue   # 条件场景编辑
    MockPreview.vue      # 一键请求 + Mock 结果预览
docker-compose.yml
```
