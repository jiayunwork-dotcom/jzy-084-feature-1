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

普通接口例如内置演示的 `GET /api/users`，可直接请求：

```bash
curl 'http://localhost:4000/mock/api/users'                 # 默认响应
curl 'http://localhost:4000/mock/api/users?vip=true'        # 命中「VIP」场景
curl -H 'x-token: admin' 'http://localhost:4000/mock/api/users?vip=true'  # 命中优先级更高的「管理员令牌」场景
```

内置还演示了一个**有状态资源集合** `GET /api/articles`（保存时标记形态为「资源集合」），它在同一条资源路径上具备真正的读写语义：

```bash
curl 'http://localhost:4000/mock/api/articles?page=1&pageSize=10'   # 列表（翻页 + 按字段过滤）
curl 'http://localhost:4000/mock/api/articles/1'                    # 按 id 取详情
curl -X POST 'http://localhost:4000/mock/api/articles' \
  -H 'Content-Type: application/json' -d '{"title":"新文章","category":"tech"}'   # 新建
curl -X PATCH 'http://localhost:4000/mock/api/articles/1' \
  -H 'Content-Type: application/json' -d '{"viewCount":99}'                        # 局部更新
curl -X PUT   'http://localhost:4000/mock/api/articles/1' \
  -H 'Content-Type: application/json' -d '{"title":"整体替换"}'                    # 整体替换
curl -X DELETE 'http://localhost:4000/mock/api/articles/1'                         # 删除
curl -X POST 'http://localhost:4000/api/interfaces/<接口id>/resource-reset'        # 一键恢复初始种子
```

响应头 `X-Mock-Scenario` 标明本次命中的场景（`default` 表示默认响应/集合读写），
`X-Mock-Mode` 标明本次走的是 `standard`（现生成）/`scenario`（命中条件场景）/`resource`（集合读写）。

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

### 资源集合（有状态 Mock）
接口可标记为「资源集合」形态，并挑选一个字段结构（就地定义或引用公共模型，多层引用照样展开）作为集合记录的形态。平台在**启动时（及首次访问兜底）**按该结构、用同一套「字段名推测 + 类型递归展开」生成逻辑预先种入固定数量的记录，这批记录一旦生成就冻结为集合的真实内容，随 PostgreSQL 一起持久化，重启不丢。

同一条资源路径上的不同方法落地为真实读写：

| 请求 | 语义 |
| --- | --- |
| `GET /res` | 当前集合记录列表，返回 `{ data, pagination:{page,pageSize,total,totalPages} }`；`page`/`pageSize`（最大 100）翻页，其余任意 `?字段=值` 对顶层原始字段做精确过滤 |
| `GET /res/:id` | 返回对应记录的完整内容；不存在返回结构化 `404 RESOURCE_NOT_FOUND` |
| `POST /res` | 把请求体顶层字段并入新记录，缺失字段用同一套生成器补齐并固定，平台分配稳定递增标识（请求体自带 id 无效），`201` + `Location` |
| `PATCH /res/:id` | 局部修改：仅改给出的字段，其余字段纹丝不动 |
| `PUT /res/:id` | 整体替换：记录按当前结构重新生成并并入请求体，标识保持不变 |
| `DELETE /res/:id` | 真正移除；之后列表少一条、详情返回未找到；重复删除同样 `404` |

一致性保证（均有测试锁定）：
- 任意「写—读」序列后，读取结果如实反映所有写操作的累计状态；
- 标识一经分配在记录删除前稳定不变，不随其它记录增删漂移；删除只移除行，不复用 id；
- 「生成一次」的字段未被显式更新时，历次读取值完全相同；
- 并发写入由数据库原子自增计数器 + 唯一约束保证标识不重复、记录不覆盖、计数对得上；
- 管理 API `POST /api/interfaces/:id/resource-reset` 一键把集合恢复到**最初种入的那一批**（快照原样回滚，计数器回拨），如同从没改过；修改接口定义则丢弃旧状态、按新结构重新播种。

**条件场景与集合读写的关系（规则确定、不留模糊地带）**：对资源集合的每个请求，先按声明顺序判定条件场景——**命中场景则完全由场景接管**（返回其生成响应与状态码），未命中任何场景时才落到上面的集合读写语义。即场景是请求级的临时覆盖，集合是持久的默认行为。

**路由空间保护**：资源集合接管其基础路径与恰好在其下一层的 `/:id`；该空间内不允许再建任何普通接口/其它集合，保存时以结构化错误拒绝。资源集合记录结构引用公共模型时，公共模型既有的循环引用检测同样生效，不会因走集合路径而绕过。

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

后端测试（Node 内置 test runner，共 100+ 个）锁定全部正确性基准：

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
- **资源集合**：写读混合序列的最终状态、标识稳定不漂移、生成一次字段历次一致、
  20 路并发写入无重复标识/覆盖、翻页过滤、PUT/PATCH/DELETE 语义、404/405/400 结构化错误、
  场景优先于集合读写、恢复初始种子、更新定义后重新播种、重启后状态与计数器持久、
  路由空间冲突拦截（均在 pg-mem 的完整 HTTP 集成链路中验证）；
- 普通接口的无状态现生成、条件场景、成环检测在改造后的行为回归；
- 基于内存 PostgreSQL（pg-mem）的完整 HTTP 集成链路：保存定义 → 真实请求 Mock 端点。

## 目录结构

```
backend/
  src/
    db/                  # pg 连接、建表、接口/模型/资源集合仓储、演示数据
    services/            # 校验、成环检测、唯一性（含资源路由空间）、业务编排
    mock/
      field-inference.js # 字段名 -> 语义类别
      data-generator.js  # 假数据递归生成（独立模块，普通接口与资源集合共用）
      scenario-matcher.js# 条件场景按序匹配（独立模块）
      resource-store.js  # 资源集合状态引擎：播种/增删改查/过滤翻页/重置（纯函数可单测）
      resource-dispatcher.js # 资源请求分发：场景优先判定 + 方法×(集合/单条)语义
      dispatcher.js      # Mock 总分发：普通接口现生成 vs 资源集合读写 分流
    routes/              # models / interfaces(含资源状态/重置) / projects / mock 路由
frontend/
  src/components/
    InterfaceEditor.vue  # 接口编辑（普通/资源集合两种形态）
    ResourceConsole.vue  # 资源集合联调台：实时记录列表 + 翻页过滤 + 一键恢复
    ResourceTester.vue   # 集合操作面板：列表/详情/新建/PUT/PATCH/DELETE
    ModelEditor.vue      # 公共模型编辑
    SchemaEditor.vue     # 递归字段树
    ScenarioEditor.vue   # 条件场景编辑
    MockPreview.vue      # 普通接口的一键请求 + Mock 结果预览
docker-compose.yml
```
