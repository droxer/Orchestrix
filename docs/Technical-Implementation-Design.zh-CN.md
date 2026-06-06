# Relay 技术实现设计 V1.0

企业 AI Workforce Platform / Control Plane / Agent Runtime / Execution Plane / Memory / Governance

本文把 Relay 的产品与架构策略翻译为实现蓝图，定义可部署服务、职责边界、数据模型、运行流程、集成契约和分阶段交付。阅读顺序建议：先读 [Architecture-Design.zh-CN.md](Architecture-Design.zh-CN.md)，再读本文。

## 文档地图

| 章节 | 目的 |
| :- | :- |
| 0-1 | 实现定位和系统边界 |
| 2 | 可部署组件和职责 |
| 3 | 核心数据模型与事件模型 |
| 4 | 运行流程 |
| 5 | 公共与内部 API |
| 6-7 | 安全和可观测性 |
| 8 | 部署拓扑 |
| 9 | 分阶段实施计划 |
| 10 | 当前本地实现映射 |
| 11-13 | 决策、开放问题和下一步 |

## 0. 实现定位

Relay 应实现为控制平面优先的 Agent 平台。Claude Code、Codex、Pi 等 Agent CLI 是执行引擎，不是系统事实来源。Relay 负责任务身份、授权、工作流状态、审批关口、审计轨迹、记忆写回、沙箱生命周期和工具策略。

沙箱是执行平面。它可以包含最小 guest worker 来执行命令和转发流，但不能拥有持久任务状态、审批权威、权限决策、长期密钥或组织记忆。

## 1. 系统边界

| 边界 | Relay 内部 | Relay 外部 |
| :- | :- | :- |
| 产品工作流 | 任务、会话、分配、审批、handoff、review | 外部工单、CRM、Git host、CI、文档系统 |
| Agent 编排 | Agent 选择、prompt 组装、状态转移、重试、取消 | Claude/Codex/Pi 模型内部 |
| 执行 | 沙箱生命周期、命令执行策略、流捕获 | Host OS 内部、云厂商沙箱实现 |
| 工具访问 | MCP Gateway、工具注册、策略检查、审计 | 单个 SaaS/内部 API |
| 记忆 | 个人/任务/项目/组织记忆、写回审批、检索索引 | 源文档和外部知识库 |
| 治理 | 身份、租户策略、任务范围、审批服务、审计日志 | 企业 IdP 和 SIEM 消费方 |

## 2. 可部署组件

### 2.1 Channel Layer

职责：接收来自 Web、CLI/TUI、Slack/Teams/Feishu、Email、Webhook 和 API 的工作；规范化为 Relay task/session；展示审批卡片、review summary、artifact 和实时状态。

初始实现保留本地 CLI/TUI 作为开发者 MVP 渠道；后续 Web API/UI 作为同一 task/session API 的客户端。

### 2.2 Control Plane API

职责：租户、用户、工作区、任务、会话、分配、审批、artifact、audit API；执行前授权和策略检查；PostgreSQL 持久化；SSE/WebSocket 实时更新。

建议：PostgreSQL 作为事实来源，Redis 用于短期协调、限流和 fanout，对象存储保存大 artifact。本地 MVP 继续使用 `.relay/` 文件，但模型应直接映射到未来 PostgreSQL 表。

### 2.3 Workflow Runtime

职责：执行长运行任务状态机，持久化进度和可恢复状态，协调审批等待、Agent run、重试、取消和 handoff，并发出 task/session events。

建议：Temporal 管 durable workflow；Relay Runtime library 包含 workflow definition、assignment policy、prompt assembly、routing 和 event emission；LangGraph 只用于模型侧规划，不作为事实来源。

示例：

```text
engineering_fix:
  create session
  wait for human approval
  run claude implement
  run pi test/follow-up
  run codex review
  if approved: complete
  if rejected: route feedback to implementer
  if failed: retry within policy or mark blocked
```

### 2.4 Agent Runtime

职责：把任务和会话状态转换为 Agent-specific prompt；选择 Agent role/mode；通过执行平面启动 Claude/Codex/Pi；解析结构化输出并归一化为 Relay events；执行 per-agent failure limit 和 handoff rule。

规则：Agent CLI 在执行平面运行；prompt 不包含长期密钥；JSON/JSONL 必须渲染为可读流并捕获为事件；review 输出必须包含机器可读 verdict marker；命令构造与 workflow policy 分离。

### 2.5 Execution Plane

职责：为代码、脚本、文件处理、浏览器自动化和 Agent CLI 提供隔离执行；挂载 scoped workspace；注入任务级短期凭据；把 stdout/stderr 流回控制平面；支持取消和清理。

沙箱分层：

| Tier | 用途 | Runtime |
| :- | :- | :- |
| L0 | 无代码执行，纯检索或总结 | 受限 worker 或 control-plane-only |
| L1 | 短代码/数据任务 | BoxLite |
| L2 | 依赖安装、批处理、中风险 | Kubernetes Job + gVisor |
| L3 | 未知/客户上传代码 | E2B、Kata 或等价高隔离沙箱 |
| L4 | 长期开发工作区 | Cloud Workstations 或托管开发环境 |

控制平面和 guest worker 边界：Relay daemon 在沙箱外；guest worker 只能执行已批准命令、转发流、报告退出状态和本地文件操作，不能做授权决策、拥有工作流状态、保存持久记忆或持有长期密钥。

### 2.6 MCP Gateway 和工具层

职责：注册工具和内部连接器；认证用户和 Agent；执行 user permission、agent permission、task scope、tool policy；代理内部 API；审计每个工具调用。

关键服务：Tool Registry、Policy Engine、Secret Broker、MCP Gateway。

写策略：低风险读取经策略检查后可执行；敏感读取需要更强 scope 和审计；外部写入、客户可见内容、生产变更、支付、删除、法律/合同等高风险动作默认需要人工审批。

### 2.7 Memory Plane

职责：检索个人、任务、项目、团队和组织记忆；存储 session 结果、artifact、决策、可复用模式和反馈；区分 raw artifact 与 curated memory；支持写回审核和脱敏。

建议存储：PostgreSQL 保存 canonical memory object 和关系；pgvector 做 MVP embedding；规模增长后引入 Qdrant、OpenSearch 和对象存储。

写回流程：

```text
session completed
extract candidate memories
classify sensitivity and scope
deduplicate against existing memory
request review when policy requires it
persist accepted memory
index for retrieval
link memory to source session/artifacts
```

### 2.8 Governance Plane

职责：执行身份、权限、审批、策略、保留和审计；提供租户级控制，包括允许的 Agent、工具、网络出站、数据驻留和记忆写回；生成合规可用事件历史。

审计事件应覆盖 task/session 创建、assignment/handoff、人工决策、沙箱生命周期、命令执行、工具调用请求/决策/结果、secret issuance、memory read/writeback、artifact creation、外部写入。

## 3. 核心数据模型

本地 `.relay` 文件是开发者 MVP 持久化层；生产环境 PostgreSQL 成为事实来源，但概念模型不变。

核心实体：

| 实体 | 目的 |
| :- | :- |
| Tenant | 企业边界和策略根 |
| User | 来自 IdP 的人类身份 |
| AgentIdentity | Claude/Codex/Pi/custom agent 身份与权限 |
| Workspace | repo、项目、业务工作区或挂载执行上下文 |
| Task | 持久工作项 |
| Session | 一条执行线程或 handoff chain |
| Assignment | session 中一次 Agent role/mode step |
| Artifact | 命令日志、diff、报告、计划、总结 |
| Approval | 人工关口和决策记录 |
| ToolCall | 受治理的内外部工具调用 |
| SandboxRun | 执行平面生命周期记录 |
| MemoryObject | 已接受的持久记忆 |
| AuditEvent | 不可变治理事件 |

事件族：

```text
task.created
task.updated
task.assigned
task.status
task.session_linked

session.created
session.status
assignment.planned
human.decision

sandbox.created
sandbox.ready
sandbox.destroyed

agent.started
agent.output
agent.completed
agent.failed

tool.requested
tool.allowed
tool.denied
tool.completed

artifact.created
review.verdict
memory.candidate_created
memory.written

session.completed
session.failed
session.cancelled
```

初始 PostgreSQL 表：`tenants`、`users`、`agent_identities`、`workspaces`、`tasks`、`task_events`、`sessions`、`session_events`、`assignments`、`approvals`、`artifacts`、`sandbox_runs`、`tool_registry`、`tool_calls`、`memory_objects`、`memory_links`、`audit_events`。

## 4. 运行流程

任务创建：认证用户、授权工作区/任务创建、创建 task、可选创建 pending session、发出 events、返回 id。

分配审批：生成 assignment plan，policy engine 分类风险；如需审批则创建 approval、通知人类、暂停 workflow；否则继续。

Agent 执行：解析任务上下文和 memory，请求沙箱，准备 workspace 和 scoped credentials，构建命令与 prompt，执行并流式输出，捕获 artifact，解析结构化输出，销毁或保留沙箱，发出 assignment result，并路由下一步。

工具调用：MCP Gateway 接收调用，解析 user/agent/tenant/task/tool，评估策略，必要时暂停并请求审批，允许后签发短期凭据，执行调用，记录审计和结果摘要。

会话完成：最终 Agent/review 完成，写入 artifact，提取 memory candidates，必要时请求写回审核，标记 session completed/failed，更新 task 状态，通知 channel client。

## 5. API Surface

最小 API 组：

```text
/v1/tasks
/v1/sessions
/v1/assignments
/v1/approvals
/v1/artifacts
/v1/events
/v1/workspaces
/v1/tools
/v1/memory
/v1/audit
```

执行 API：

```text
POST /v1/sessions
POST /v1/sessions/{id}/assignments
POST /v1/sessions/{id}/start
POST /v1/sessions/{id}/cancel
POST /v1/approvals/{id}/decisions
GET  /v1/sessions/{id}/events
GET  /v1/sessions/{id}/artifacts/{artifact_id}
```

内部运行时 API 包括 workflow start/signal/cancel/query，execution plane create/prepare/exec/stream/kill/destroy，以及 execution_started/stdout_chunk/stderr_chunk/execution_completed/sandbox_error/heartbeat。

## 6. 安全实现

- 长期凭据存入 vault。
- 通过 Secret Broker 签发任务级短期 token。
- 不在 events、artifacts、memory 或 prompts 中持久化 secret value。
- 写 artifact 前对已知 secret pattern 脱敏。
- 沙箱默认无入站网络，出站按租户/工作区/任务 allowlist。
- 只挂载 scoped workspace path，尽量使用只读挂载。
- 短任务沙箱完成后销毁，只保留声明的 artifacts。

默认需要审批的动作：对客户/伙伴外发消息、生产部署、生产数据变更、删除/破坏性操作、支付/账单/合同/法律动作、敏感或组织级记忆写回、授予新工具权限。

## 7. 可观测性

指标包括任务完成率、审批等待时间、Agent 执行时长、沙箱启动时间、工具调用延迟和拒绝率、review 通过/拒绝率、各 Agent 重试次数、memory writeback 接受率、每 session 成本。

日志和 trace 应包含 `tenant_id`、`user_id`、`task_id`、`session_id`、`assignment_id`、`sandbox_id`、`execution_id`、`tool_call_id`、`trace_id`。

每个 session 应能回答：谁请求、哪个 Agent 运行、执行了什么命令/工具、检查了什么权限、审批是否通过、产生了什么 artifact、读写了什么 memory、为何完成/失败/暂停。

## 8. 部署拓扑

本地 MVP：

```text
Relay CLI/TUI
Relay local API
.relay file store
BoxLite sandbox
Claude/Codex/Pi CLIs in sandbox
```

团队服务器 MVP：

```text
Web app
Control Plane API
PostgreSQL
Redis
Temporal
BoxLite worker hosts
MCP Gateway
Secret Broker
Object storage
```

企业 SaaS/私有化：

```text
Next.js web app
Control Plane API service
Workflow service
Execution manager
Sandbox worker pool
MCP Gateway
Policy service
Secret Broker
Memory service
PostgreSQL
Redis
Temporal cluster
Vector/search storage
Object storage
Audit/SIEM export
```

## 9. 实施阶段

1. **Phase 0: Local Relay Hardening**：保持 TypeScript host orchestrator，BoxLite 生命周期在沙箱外，稳定 task/session event model，完善 redaction 和 artifact。
2. **Phase 1: Execution Service Boundary**：抽取 execution interface，引入 `ExecutionManager`，可选 guest worker，并保持授权和 workflow state 在控制平面。
3. **Phase 2: Durable Backend**：把 `.relay` store 迁移到 PostgreSQL repository，引入 API auth、workspace ownership、Redis/SSE/WebSocket fanout、对象存储。
4. **Phase 3: Temporal Runtime**：实现 Temporal workflow、approval wait、cancellation signal、retry policy 和 failure classification。
5. **Phase 4: MCP Gateway and Governance**：建设 Tool Registry、Policy Engine、Secret Broker，并让工具调用通过 MCP Gateway。
6. **Phase 5: Memory Plane**：添加 memory object schema、prompt assembly retrieval、session completion extraction、reviewable writeback、向量和关键词索引。
7. **Phase 6: Enterprise Readiness**：租户策略、审计导出、数据保留、Admin UI、多区域/私有化部署和沙箱分层。

## 10. 当前本地实现映射

### 10.1 运行入口

| 入口 | 文件 | 行为 |
| :- | :- | :- |
| `relay` | `src/index.ts` -> `src/relay/workflow.ts` | 无参数时启动 Ink TUI |
| `relay run-workflow <task>` | `src/relay/workflow.ts` | 启动 BoxLite 并运行 Claude -> Pi -> Codex 默认工作流 |
| `relay sessions` | `src/relay/workflow.ts` | 列出 `.relay/sessions` 中的 persisted sessions |
| `relay show <session-id>` | `src/relay/workflow.ts` | 打印紧凑 session summary |
| `relay serve --port <port>` | `src/relay/workflow.ts` -> `src/relay/server.ts` | 提供本地 JSON/SSE API |
| Library exports | `src/relay.ts` | re-export public types、stores、controller、command builders、renderers、workflow helpers |

### 10.2 本地数据模型

本地 MVP 持久化两类记录：`RelayTask` backlog/Kanban 工作项，以及 `RelaySession` 一次运行或 handoff chain 的追加式执行历史。

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

`LocalTaskStore` 负责 task persistence 和 materialization；`LocalSessionStore` 负责 session persistence、artifact files 和 materialization。新增 event type 时必须同步更新 materializer 和测试。

### 10.3 Execution Controller

`SessionController` 是持久状态与 Agent 执行之间的本地边界，负责创建 session、链接 task、发出 Agent lifecycle/output events、写 command output artifacts、发出 Codex review verdict、记录 human decision、标记完成/失败，并更新关联 task 状态。

新增 TUI/API 的可写执行控制时，不要绕过 `SessionController`。

### 10.4 Agent Execution

Agent-specific execution 位于 `src/relay/nodes.ts`：

| Node | Command Builder | Renderer |
| :- | :- | :- |
| `claudeImplementNode()` | `buildClaudeImplementCommand()` | `ClaudeStreamRenderer` |
| `piImplementNode()` | `buildPiImplementCommand()` | `PlainTextStreamRenderer` |
| `codexImplementNode()` | `buildCodexImplementCommand()` | `CodexStreamRenderer` |
| `codexReviewNode()` | `buildCodexReviewCommand()` | `CodexStreamRenderer` |

Claude 用 `--output-format stream-json`；Codex 用 `exec --json`；Pi 只有在支持 `-P`/`--print-streaming` 时才使用 `-P`，否则回退到 `-p`。Review mode 要求 Codex 输出 `RELAY_REVIEW_VERDICT: APPROVED` 或 `RELAY_REVIEW_VERDICT: REJECTED`。

### 10.5 Workflow 和 BoxLite Runtime

`withOrchestratorSession()` 负责确保单实例、导出 OCI 镜像、创建 BoxLite runtime、把 host workspace 挂载到 guest `/workspace`、同步 guest ownership、配置 Codex/Pi auth/env、执行 action，并停止/移除 runtime。

`ensureAgentReady()` 做 agent preflight 并在当前 orchestrator session 内缓存 readiness：Claude `claude --version`；Codex 写 guest auth 后执行 `codex login status`；Pi 写 auth/model config 后执行 preflight。

正常执行使用 `make run` 或 `npm run run`。只有 `dockerfile` 或 devbox image 变化时使用 `make run-fresh`。

### 10.6 Routing、TUI、本地 API

默认脚本工作流：

```text
Claude implement -> Pi implement/test follow-up -> Codex review
```

TUI 支持 `@claude`、`@pi`、`@codex` 等前置 mention，以及 `/approve`、`/reject`、`/cancel`、`/rerun`、`/handoff`、`/sessions`、`/open`、`/summary`、`/quit`。

本地 API 默认运行在 `127.0.0.1:8787`，暴露 task/session endpoint。它可以创建任务、pending session、assignment-plan artifact、记录 decision、暴露历史 events/artifacts，但不直接启动 BoxLite 或执行 Agent。

未来 execution endpoint 必须调用 CLI/TUI 同一套 `SessionController` 和 orchestrator readiness flow。

### 10.7 环境、认证与测试

`src/relay/env.ts` 管环境，`src/relay/guest.ts` 管 guest setup。Host 配置会转换成 guest 文件/env，包括 `/home/agent/.codex`、`/home/agent/.pi/agent`、`/workspace` 挂载和 `runAsAgent()` 执行。

运行测试：

```text
npm test
```

测试范围：

- `tests/session.test.ts`：event stores、artifacts、controller、linked task updates、HTTP API routes。
- `tests/handoff.test.ts`：routing、prompt contracts、Codex verdict parsing、command generation、stream renderers、BoxLite execution helpers。
- `tests/tui.test.tsx`：TUI parsing、shortcuts、rendering、cancellation、session state updates、slash commands。

## 11. 关键工程决策

| 决策 | 方向 |
| :- | :- |
| 控制平面位置 | 沙箱外 |
| 沙箱进程 | 最多可选最小 guest worker |
| 持久状态 | PostgreSQL/event-sourced task 和 session logs |
| 工作流引擎 | Temporal |
| Agent CLI | 在沙箱内执行 |
| Secrets | 任务级短期凭据 |
| 工具访问 | MCP Gateway + policy + audit |
| Memory | 分层 memory + 审核写回 |
| API state | task/session API 是 canonical，channel 是客户端 |
| 当前本地模式 | `.relay` file store 对 developer MVP 可接受 |

## 12. 开放技术问题

- 云控制平面后端语言用 TypeScript 复用代码，还是 FastAPI/Go 贴近企业服务习惯？
- Guest worker 使用 stdio、Unix socket 还是沙箱内 localhost HTTP？
- 工具和审批策略最小 policy language 是什么？
- Temporal 已拥有 durable state 后，LangGraph 还需要多少？
- 哪些 memory candidate 默认需要人工审核？
- 企业私有化默认沙箱层级是什么？
- Artifact 持久化前如何做 redaction？

## 13. 近期下一步

1. 添加控制平面位置和 sandbox guest-worker scope 的 ADR。
2. 定义 `ExecutionManager`、`SandboxHandle`、`ExecutionHandle` TypeScript 接口。
3. 把直接 BoxLite 使用移到 execution interface 后面，不改变行为。
4. 保持当前 `SessionController` 作为本地 durable orchestration boundary。
5. 增加测试证明 Agent execution 仍能 stream、capture artifacts、support cancellation，并且不会把 task authority 移入沙箱。
