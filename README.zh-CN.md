# Relay

每一位员工，都被 AI 放大。

Relay 是一个面向企业的 AI Workforce Intelligence Platform。它的产品方向是为每位员工提供一个长期协作的 AI Partner，把组织知识、业务流程、工具系统和 Agent 执行能力连接起来，让员工更快创造价值。

本仓库是当前的本地优先开发者 MVP：一个 TypeScript CLI/TUI，用 BoxLite 隔离工作区运行 Claude Code、Pi 和 Codex，将任务与会话历史持久化到 `.relay/`，并提供本地只读 JSON/SSE API。

Relay 不是“聊天机器人加工具调用”，也不是员工替代系统。它采用控制平面优先的架构：Relay 负责任务身份、工作流状态、审批关口、审计轨迹、记忆写回、沙箱生命周期和工具策略；Agent CLI 只是执行引擎。

## 文档地图

- [产品设计](docs/Product-Design.zh-CN.md)：产品战略、用户、场景、定位、路线图和商业模式。
- [架构设计](docs/Architecture-Design.zh-CN.md)：目标架构、平面划分、运行时层、沙箱策略、MCP Gateway、记忆与治理。
- [技术实现设计](docs/Technical-Implementation-Design.zh-CN.md)：组件边界、数据模型、API、运行流程、安全、可观测性、实施阶段和当前本地实现映射。
- [视觉设计](docs/Design.zh-CN.md)：营销与 UI 设计语言、视觉系统方向。

英文版本仍保留在同名 `.md` 文件中。

## 产品方向

Relay 的长期产品形态分为三层：

- **Personal Relay**：面向每位员工的 AI Partner，提供个人工作助手、知识助手、任务执行和个人记忆。
- **Team Relay**：面向团队，提供团队状态、跨人协作、项目风险和最佳实践沉淀。
- **Organization Relay**：面向组织，提供组织知识、专家经验资产、能力图谱、治理分析和记忆写回。

优先进入的高价值场景包括销售价值创造、客户成功与续约增长、产品与工程协作、组织知识助手、专家经验捕获。

## 当前本地 MVP

当前仓库实现的是工程协作的本地开发者通道：

- **持久任务与会话**：在 `.relay/tasks` 与 `.relay/sessions` 下保存追加式事件日志和派生快照。
- **人工审批关口**：TUI 分配会先创建 pending session，再通过命令批准、拒绝、取消、重跑、打开或总结。
- **多 Agent 编排**：Claude、Pi、Codex 作为 CLI Agent 在 BoxLite 中运行。
- **可读流输出**：Claude `stream-json` 和 Codex `exec --json` 会被渲染成人类可读终端文本，而不是直接打印原始 JSONL。
- **产物持久化**：命令输出、分配计划、日志和评审结果会写入 session artifacts。
- **本地 API**：`relay serve` 读取 `.relay/` 中真实任务和会话状态。

脚本化默认工作流：

```text
Claude implement -> Pi implement/test follow-up -> Codex review
```

Codex review 必须输出：

```text
RELAY_REVIEW_VERDICT: APPROVED
```

或：

```text
RELAY_REVIEW_VERDICT: REJECTED
```

## 目标架构

目标系统分为四个架构平面：

- **控制平面**：租户、用户、工作区、任务、会话、分配、审批、策略决策、工作流状态和审计权威。
- **执行平面**：沙箱命令、Agent CLI、文件处理、浏览器自动化、流转发和隔离工具适配器。
- **记忆平面**：个人、任务、项目、团队和组织记忆，检索、来源链接、索引和经审核写回。
- **治理平面**：身份、权限、审计、保留策略、工具策略、审批规则和合规控制。

推荐的企业级栈包括 Web/API 控制平面、PostgreSQL、Redis、Temporal、Relay Runtime、BoxLite/Kubernetes 沙箱 Worker、MCP Gateway、Secret Broker、对象存储，以及按规模引入的向量/搜索存储。

当前本地 MVP 使用 `.relay/` 文件持久化，但事件模型应能平滑映射到后续 PostgreSQL 表。

## 前置条件

- Node.js 22.19 或更高版本
- npm
- 正在运行的 Docker 本地 daemon
- BoxLite 所需硬件虚拟化能力
- 计划运行的 Agent API Key

在 `.env` 中设置凭据：

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
OPENAI_BASE_URL=...     # 可选兼容端点
OPENAI_MODEL=...        # 可选
PI_API_KEY=...          # 可选覆盖
PI_BASE_URL=...         # 可选覆盖
PI_MODEL=...            # 可选覆盖
```

不要把长期密钥写入 prompt、event、artifact 或 memory。

## 设置

安装依赖并运行测试：

```bash
npm install
npm test
```

构建并导出 BoxLite devbox 镜像：

```bash
make devbox-oci
```

只有当 `dockerfile` 变化时才需要重建/导出镜像：

```bash
make run-fresh
```

普通源码改动只需要：

```bash
make run
```

指定挂载工作区：

```bash
make run WORKSPACE=/path/to/workspace
```

## 运行 Relay

启动 TUI：

```bash
make run
# 或
npm run run
```

在 TUI 中分配 Agent：

```text
@claude fix auth middleware
@claude @pi @codex add tests for upload routing
@codex inspect the current diff
```

常用 slash 命令：

```text
/approve
/reject missing tests around timeout handling
/cancel
/rerun codex
/handoff claude
/sessions
/open <session-id>
/summary
/quit
```

运行脚本化工作流：

```bash
relay run-workflow "fix auth middleware"
```

列出和查看会话：

```bash
relay sessions
relay show <session-id>
```

停止 Relay 和 BoxLite 进程：

```bash
make stop
```

## 本地 API

启动本地 JSON/SSE API：

```bash
make serve
# 或指定端口
make serve PORT=9000
```

默认监听 `127.0.0.1:8787`。服务只读取 `.relay/tasks` 与 `.relay/sessions` 的真实文件，不注入 seed、mock 或虚假任务。

当前路由：

```text
GET /
GET /tasks
POST /tasks
GET /tasks/:id
PATCH /tasks/:id
POST /tasks/:id/assign
POST /tasks/:id/pickup
GET /tasks/:id/events
GET /sessions
GET /sessions/:id
GET /sessions/:id/events
GET /sessions/:id/artifacts/:artifactId
```

本地 API 可以创建任务、创建 pending session、附加 assignment-plan artifact、记录决策，并暴露历史 events/artifacts。Agent CLI 执行仍走 orchestrator/TUI 路径，以集中管理 BoxLite 生命周期、凭据、ready check、流输出和取消。

## 数据布局

Relay 在 `.relay/` 下写入本地生成状态：

```text
.relay/
  tasks/
    <task-id>/
      events.jsonl
      snapshot.json
  sessions/
    <session-id>/
      events.jsonl
      snapshot.json
      artifacts/
        <artifact-id>.<ext>
```

事件日志是事实来源。snapshot 是从事件派生的物化视图。

## 源码地图

```text
packages/relay-daemon/src/cli.ts              兼容 CLI 入口
packages/relay-daemon/src/daemon-cli.ts       host daemon binary 入口
packages/relay-core/src/index.ts              shared protocol and agent runtime exports
packages/relay-daemon-node/src/cli.ts          daemon node binary 入口
packages/relay-daemon-node/src/index.ts        sandbox-side daemon node runtime
packages/relay-daemon/src/index.ts            public daemon re-export surface
packages/relay-daemon/src/relay/controller.ts session-aware orchestration controller
packages/relay-daemon/src/relay/session.ts    session 事件模型和本地 store
packages/relay-daemon/src/relay/task.ts       backlog/task 事件模型和本地 store
packages/relay-core/src/nodes.ts      Claude、Pi、Codex 执行节点
packages/relay-core/src/commands.ts   Agent 命令构造
packages/relay-core/src/prompts.ts    Agent prompt 构造
packages/relay-core/src/renderers.ts  stream-json 与 JSONL 渲染器
packages/relay-daemon/src/relay/routing.ts    默认工作流路由
packages/relay-daemon/src/relay/workflow.ts   BoxLite 生命周期和运行入口
packages/relay-daemon/src/relay/server.ts     本地 JSON/SSE API
packages/relay-tui/src/cli.ts                 TUI binary 入口
packages/relay-tui/src/tui.tsx                Ink TUI 和人工命令
```

新的 daemon public API export 放在 `packages/relay-daemon/src/index.ts`。运行时 dispatch 留在
`packages/relay-daemon/src/relay/workflow.ts`，package binary wrapper 应保持很薄。

## 开发

```bash
npm run build
npm test
make test
```

测试组织：

- `tests/session.test.ts`：事件 store、artifact、controller 行为、关联 task 更新和 HTTP API。
- `tests/handoff.test.ts`：路由、prompt 合约、Codex verdict 解析、命令生成、流渲染器和 BoxLite helper。
- `tests/tui.test.tsx`：TUI 解析、快捷方式、渲染、取消、session 状态更新和 slash 命令。

行为变更需要添加或更新聚焦测试，并运行 `npm test`。

## 实现规则

- Host orchestrator 保持 TypeScript/Node.js，不要加入 Python host code。
- 使用 BoxLite Node SDK (`@boxlite-ai/boxlite`) 管理 VM 生命周期和命令执行。
- 持久状态保持 append-only；新增事件，不改历史。
- snapshot 必须由事件日志派生。
- task 与 session 通过 `task.session_linked` 保持松耦合。
- API 状态必须真实：不要 seed demo task、fake agent run 或 dummy artifact。
- Agent 执行放在 `nodes.ts`，命令构造放在 `commands.ts`，工作流生命周期放在 `workflow.ts` / `box.ts`。
- 未来 execution endpoint 必须走 `SessionController` 和 CLI/TUI 使用的同一套 orchestrator readiness flow。
- Claude 使用 `--output-format stream-json`；Codex 使用 `exec --json`；两者都通过 stream renderer 渲染，不直接打印 raw JSON。
- Pi CLI 版本不同：只有当 `pi --help` 支持 `-P` 或 `--print-streaming` 时才使用 `-P`，否则回退到 `-p`。

## 路线图

技术实施阶段：

1. **Local Relay hardening**：稳定 TypeScript 编排、BoxLite 生命周期、事件 store、命令脱敏和 artifact。
2. **Execution service boundary**：抽取 `ExecutionManager` 接口，同时保持控制平面权威在沙箱外。
3. **Durable backend**：将 `.relay` store 迁移到 PostgreSQL-backed repository，引入 Redis fanout 和对象存储。
4. **Temporal runtime**：加入持久工作流状态机、审批等待、取消信号、重试和可恢复 session。
5. **MCP Gateway and governance**：加入 Tool Registry、Policy Engine、Secret Broker、审计，以及高风险写操作审批。
6. **Memory plane**：加入检索、memory candidate extraction、审核式写回、向量索引和关键词搜索。
7. **Enterprise readiness**：租户策略、审计导出、保留控制、Admin UI、私有化部署，以及跨 BoxLite、Kubernetes/gVisor、E2B/Kata、Cloud Workstations 的沙箱分层。
