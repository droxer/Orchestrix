# Relay

[English](README.md) | [简体中文](README.zh-CN.md)

<p align="center">
  <img src="assets/brand/relay-logo.svg" alt="Relay 标志" width="380">
</p>

<p align="center"><strong>让每一位员工，能力倍增。</strong></p>

Relay 是一个本地优先的 AI 工作控制平面。员工可以在一个界面中发起对话、分配持久任务、安排例行任务，并协调具名 AI 智能体与团队。

Relay 记录身份、审批、任务和历史，并跟踪每个智能体运行于哪台计算机。

Python 后端绝不直接执行智能体。Relay 守护进程在本地或托管计算机上，通过 BoxLite 或配置好的本地环境运行 Claude Code、Codex、Pi 和 Kimi。

## 当前能力

- 发起对话时明确选择智能体和计算机；智能体自行判断目标需要直接回答、调查、修改工作区、验证、评审还是澄清问题。流式查看工具输出，审批决策，取消或重试工作，并将对话移交给其他智能体。
- 在待办中规划工作、安排周期性例行任务、分配智能体或团队、设置截止日期，并查看派发及事件历史。
- 创建具名智能体和团队，管理其资料、计算机部署、工作区文件、生成产物和近期活动。
- 创建项目，将持久共享工作区和有序的项目智能体名册绑定到一台计算机，并运行共享该工作区的项目对话。
- 注册员工计算机或协调托管计算机，同时跟踪健康状态、容量、命令租约和持久身份。
- 通过统一聊天网关连接 Discord、Telegram 和 Lark，将外部身份与会话映射到 Relay。
- 在管理区域统一管理员工、智能体、计算机、集群健康、活动和令牌用量。

## 产品截图

### 发起并引导对话

选择工作在哪台计算机运行、由哪个具名智能体处理；Relay 将目标交给所选参与者，由每个智能体自行选择合适的执行路径。

<p align="center">
  <img src="docs/images/relay-threads-phosphor-zh-CN.png" alt="Relay 对话编辑器，可选择智能体和计算机" width="960">
</p>

### 规划并派发工作

待办视图集中展示优先级、分配对象、截止日期、状态和派发上下文。

<p align="center">
  <img src="docs/images/relay-backlog-phosphor-zh-CN.png" alt="Relay 任务看板" width="960">
</p>

### 协调智能体团队

团队工作区集中展示活跃运行、任务、对话、工作区文件和成员活动。

<p align="center">
  <img src="docs/images/relay-teams-phosphor-zh-CN.png" alt="Relay 团队工作区" width="960">
</p>

## 快速开始

### 前置条件

- Node.js 22.19 或更高版本
- npm
- Python 3.12 或更高版本
- [uv](https://docs.astral.sh/uv/)
- 使用 BoxLite 时需要 Docker 和硬件虚拟化支持
- 所需智能体 CLI 的凭据或本地登录状态

安装依赖并构建 TypeScript 软件包、守护进程、协调器和 Web 应用：

```bash
npm install
npm run build
```

按照[本地开发指南](docs/local-development.md)配置认证、存储和智能体凭据，然后在不同终端中分别启动服务：

```bash
make backend                     # FastAPI 控制平面，监听 127.0.0.1:8790
make daemon SANDBOX_ID=node_dev  # 连接后端的执行节点
make web                         # Next.js 应用，监听 127.0.0.1:5000
```

打开 <http://127.0.0.1:5000>。

按需运行验证和运维命令：

```bash
npm test                # 构建并运行 TypeScript 与 Python 测试套件
make supervisor         # 协调所申请的托管计算机
make backend-migrate    # 应用 Alembic 数据库迁移
make pre-commit-run     # 运行仓库检查
make stop               # 停止 Relay、守护进程、协调器和 BoxLite
```

仅在修改 `dockerfile` 或 BoxLite 镜像内容后使用 `make run-fresh`。

## 文档

从 [`docs/` 中文索引](docs/README.zh-CN.md)开始，查找环境搭建、API、产品、架构、设计、决策和运维的权威文档。
