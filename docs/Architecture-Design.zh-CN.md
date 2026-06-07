# Relay 架构设计 V2.0

<p align="center">
  <img src="../assets/brand/relay-logo.svg" alt="Relay logo" width="360">
</p>

企业 AI Workforce Platform / Agent Runtime / Sandbox / Memory / Governance

本文定义 Relay 的目标架构、战略技术选择和架构决策方向。实现级边界、数据模型、API、运行流程和工程阶段见 [Technical-Implementation-Design.zh-CN.md](Technical-Implementation-Design.zh-CN.md)。

## 0. 执行摘要

Relay 不应被设计成“聊天机器人加几个工具调用”。它应是企业混合劳动力平台的基础设施，具备持久身份、可恢复任务、可审计执行、沙箱隔离、企业权限、组织记忆和多 Agent 协作。

Relay 的架构哲学是：不是给 LLM 一个追求最大低层 VM 自由度的“机械手”，而是给它一张“企业工牌”，优先保证合规、权限检查、长流程控制和 human-in-the-loop 治理。

推荐架构使用四个架构平面：Control Plane、Execution Plane、Memory Plane、Governance Plane。运行时通过 Channel、Control Plane、Agent Runtime、Execution Plane、Tool Layer、Knowledge/Memory Layer 六层实现。

| 决策领域 | 推荐方向 |
| :-: | :-: |
| 总体架构 | Control Plane + Execution Plane + Memory Plane + Governance Plane |
| MVP 栈 | Web/API 控制平面 + PostgreSQL + Redis + Temporal + Relay Runtime + BoxLite/Kubernetes Sandbox + MCP Gateway |
| 沙箱策略 | Cloud Workstations 用于长运行开发；BoxLite 用于高频轻量短任务；Kubernetes Jobs 作为常规任务基线；gVisor/E2B 用于高风险任务 |
| 数据策略 | PostgreSQL 作为事实来源；MVP 可先用 pgvector；按规模拆分到 Qdrant、OpenSearch、ClickHouse |
| 权限策略 | 四层校验：User Permission + Agent Permission + Task Permission + Tool Policy |
| 核心壁垒 | 组织记忆、Temporal 长任务状态机、工具调用审计、Memory Writeback、企业治理 |

## 1. 架构原则

- **以员工放大为中心**：所有技术能力都服务于帮助员工更快创造价值。
- **控制平面和执行平面彻底分离**：业务管理逻辑与不可信任务执行分离。
- **执行前检查权限**：每次工具调用、文件访问和系统操作都要经过身份、权限、任务范围和策略检查。
- **偏好过程治理，而不是涌现式自治**：Relay 应依赖 MCP Gateway 和结构化 API，而不是让 Agent 通过黑盒屏幕/DOM 操作。
- **任务可恢复，而不是单轮对话**：用 Temporal 支撑长运行任务。
- **分层记忆并写回**：个人、任务、项目记忆应在任务结束后写回，形成企业经验图谱。

## 2. 核心系统架构

### 2.1 架构平面

| 平面 | 拥有 | 不应拥有 |
| :-: | :- | :- |
| Control Plane | 租户、用户、任务、会话、审批、工作流状态、策略决策 | 不可信代码执行 |
| Execution Plane | 沙箱命令、Agent CLI、文件处理、隔离工具适配器 | 持久权威、审批、长期密钥、组织记忆 |
| Memory Plane | 检索、记忆对象、写回、索引、来源链接 | 对企业事实的未经审核权威 |
| Governance Plane | 身份、权限、审计、策略、保留、审批规则 | 策略外的 opaque Agent 行为 |

### 2.2 运行时层

| 层 | 职责 | 推荐技术 | 说明 |
| :-: | :-: | :-: | :-: |
| Channel Layer | IM、Web、Email、API 入口 | Next.js、Bot Framework、Feishu/Slack/Teams SDK | 任务应可跨渠道追踪；IM 支持审批卡片 |
| Control Plane | 租户、员工、Agent ID、权限、任务、审批 | API service、PostgreSQL、Redis | PostgreSQL 是事实来源；高风险动作进入 Approval Service |
| Agent Runtime | 任务规划、状态机、工具策略、上下文组装 | LangGraph + custom Runtime + Temporal | Temporal 管可靠长流程，Relay Runtime 管业务状态和治理 |
| Execution Plane | 隔离执行代码、文件、CLI | BoxLite、Kubernetes、Cloud Workstations、gVisor | 按风险和生命周期选择隔离级别 |
| Tool Layer | 内部系统连接和工具暴露 | MCP Gateway、CLI Adapter、Secret Broker | 工具必须可注册、授权、审计、限流 |
| Knowledge/Memory Layer | 组织知识、RAG、经验捕获 | PostgreSQL、pgvector、Qdrant、OpenSearch | 不止 RAG，还包括 Memory Writeback |

## 3. 执行平面与沙箱策略

Relay 采用分层沙箱策略，在安全、启动速度、运维复杂度和私有化部署之间平衡。

| 风险级别 | 任务类型 | 执行环境 | 设计理由 |
| :-: | :-: | :-: | :-: |
| L0 低风险 | 纯文本总结、RAG 查询、无代码执行 | 无沙箱或受限 worker | 无外网或受控出网 |
| L1 高频轻量 | 短代码片段、数据转换、快速 API 包装 | BoxLite | 启动快，适合 disposable execution |
| L2 中风险/长运行 | 批处理、复杂脚本、依赖安装 | Kubernetes Job + gVisor | 多租户 SaaS 的防御增强 |
| L3 高风险 | 未知代码、客户上传代码 | E2B/Kata 等高隔离沙箱 | SaaS 可购买 E2B，私有化可接受 Kata 成本 |
| L4 长期工作区 | 持续开发、Claude Code 类工具 | Cloud Workstations | 提供持久、企业可控开发环境 |

## 4. Tool Layer：MCP Gateway 与 CLI Adapter

Relay 不仅通过沙箱限制 Agent，也通过接口限制行为。系统需要同时支持 MCP 和 CLI。

- **Tool Registry**：所有工具必须可发现、可授权、可审计。
- **MCP Gateway**：用集中认证、限流、租户隔离代理内部系统。
- **Secret Broker**：按任务签发短期 token；不要把长期密钥注入 Agent 上下文。

## 5. MVP 交付计划：Phase 1

MVP 应聚焦闭环价值，不提前建设复杂低层 VM 基础设施：

- **核心编排**：Temporal 管长运行工作流状态，LangGraph 只在模型侧规划有价值时使用。
- **沙箱交付**：优先验证 BoxLite 与 OCI 镜像调用端到端。
- **企业集成**：聚焦 MCP Gateway，用受控 API 验证安全内部系统调用。
- **标志能力**：human-in-the-loop approval 和 Memory Writeback 必须在 MVP 中工作。

## 6. 架构决策更新

- **ADR-008**：轻量和低中风险 Agent 任务优先评估 BoxLite，以替代原生 Kubernetes Pod，提升启动速度并兼容企业 OCI 基础设施。
- **ADR-007 强化**：坚持“发企业工牌，而不是造机械手”。涉及外部写入或敏感读取的任务必须执行多层权限检查，并通过 Approval Service。
- **ADR-009**：持久 Relay daemon 与控制平面权威必须在沙箱外。沙箱中最多运行最小 guest worker，用于已批准命令执行、流转发、退出状态报告和本地文件操作。
