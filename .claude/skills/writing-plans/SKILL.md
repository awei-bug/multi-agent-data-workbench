---
name: writing-plans
description: Use when turning a multi-step requirement into an implementation plan before touching code.
---

# Writing Plans

## Overview

当任务会涉及多文件修改、多个步骤、验证链路，或者需求虽然明确但实施细节还没拆开时，先写计划。

**核心原则：** 让执行者在几乎不了解上下文的情况下，也能按计划稳定落地。

## When to Use

适用于：
- 新功能开发
- 多文件重构
- 明显会跨前后端或跨测试层的改动
- 需要先统一文件边界和验证路径的任务

## Output Location

本仓库默认把计划文档落到：
- `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`

如果用户另有明确要求，以用户要求为准。

## What a Good Plan Must Include

### 1. Context
- 为什么要改
- 目标结果是什么
- 有哪些约束

### 2. File Map
- 明确会新建/修改哪些文件
- 每类文件负责什么
- 优先复用已有结构和命名方式

### 3. Recommended Approach
- 只写推荐方案
- 说明要复用的现有函数、模块或模式
- 不写泛泛口号，要和仓库实际结构绑定

### 4. Verification
- 写出可执行的验证命令与顺序
- 区分定向测试、全量测试、构建、E2E、手工验证

## Project-Specific Planning Rules

- 如果只是小修小补，不要把计划写成超大文档
- 如果已有相关计划，优先更新或续写现有计划
- 默认复用仓库现有验证口径：
  - `npm run test -- <path>`
  - `npm run test`
  - `npm run build`
  - `npm run test:e2e`
  - `python scripts/start-workspace-api.py`
  - `npm run preview -- --host 127.0.0.1 --port 4173`

## Plan Quality Checklist

写完后至少检查：
- 是否说明了改动目的
- 是否点名了关键文件
- 是否引用了现有可复用实现
- 是否给出了可执行验证步骤
- 是否避免了“TBD / TODO / 后续补齐”这类空话

## Anti-Patterns

不要写成这样：
- “加上必要的错误处理”
- “修改相关组件”
- “补测试”
- “之后再看是否需要构建验证”

这些都太空，不足以指导执行。

## Bottom Line

**计划不是任务标题列表，而是可直接执行的实施说明。**
