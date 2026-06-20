# CLAUDE.md

## Project Overview

这是一个“多 Agent 协同数据分析创作工作台”项目，前端采用 React + TypeScript + Vite，后端采用 Python API。

优先阅读这些现有文档获取项目上下文：
- `项目总览.md`
- `多Agent协同数据分析.md`
- `docs/superpowers/specs/`
- `docs/superpowers/plans/`

## Runtime and Verification Defaults

### Stable startup path

除非用户明确要求开发态调试，否则默认把下面这组命令视为稳定运行口径：

1. 前端构建：`npm run build`
2. 前端预览：`npm run preview -- --host 127.0.0.1 --port 4173`
3. 后端启动：`python scripts/start-workspace-api.py`

不要把 `vite dev` 作为默认稳定验证方式。只有在用户明确要开发态热更新、或问题明确只在 dev 环境复现时，再考虑 `npm run dev`。

### Test order

做修改后默认按这个顺序验证：

1. 先跑**最小定向验证**
   - 单个 Vitest 文件：`npm run test -- <path>`
   - 相关后端测试：按具体测试入口运行
2. 再跑**相关测试集**
   - 前端全量单测：`npm run test`
3. 再跑**构建验证**
   - `npm run build`
4. 必要时再跑**E2E / 手工联调**
   - `npm run test:e2e`
   - `npm run preview -- --host 127.0.0.1 --port 4173`
   - `python scripts/start-workspace-api.py`

宣称“完成”“修复”“通过”之前，必须先给出本次会话中的新鲜验证证据。

## Working Style

### Planning

对多文件修改、功能开发、架构调整或需求不够明确的任务，优先先给出计划，再实施。

如果任务已有计划文档，优先复用现有计划并补齐缺口，而不是重新发明一套流程。

### Debugging

遇到 bug、测试失败、构建失败或联调异常时：
- 先复现并定位根因
- 先读错误信息、调用链、最近改动
- 先对比工作正常的相邻实现
- 不要直接堆“猜测性修复”

### Verification

不要把“代码改了”当成“问题解决了”。
必须用与声明相匹配的命令验证，例如：
- 声称测试通过 → 运行对应测试
- 声称构建成功 → 运行 `npm run build`
- 声称页面可用 → 至少完成预览或手工链路验证

## Worktree and Branch Rules

只有在以下情况才创建或切换 worktree：
- 用户明确要求“worktree”
- 当前任务明确需要隔离工作区

如果 Claude Code 原生 worktree 工具可用，优先使用原生能力，不要手搓并行隔离流程。

以下操作都必须先得到用户明确确认：
- 创建新分支用于外部协作交付
- push 到远端
- 创建 PR
- merge 到主分支
- 删除分支
- 删除 worktree

## Skill Usage Notes

本仓库包含项目本地 skill，位于 `.claude/skills/`。
使用这些 skill 时：
- 复用仓库已有命令、文档与约束
- 不要照搬外部平台（Codex/OpenAI/GitHub workflow）的专属术语
- 不要假设必须存在某个特定子代理工具名

## Practical Reminders

- 修改测试时，优先测试真实行为，不要只测试 mock 自身
- 需要新增计划时，优先落到 `docs/superpowers/plans/`
- 需要定位问题时，优先从最小复现、错误输出、数据流和工作正常的相邻代码入手
- 如果用户要求的是“验证是否真的可用”，不要只跑静态测试；必要时启动预览服务和后端 API 做联调
