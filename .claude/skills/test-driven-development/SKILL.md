---
name: test-driven-development
description: Use when implementing a feature, bug fix, or behavior change before writing production code.
---

# Test-Driven Development

## Overview

先写测试，确认它因为正确原因失败，再写最小实现让它通过。

**核心原则：** 如果你没看见测试先失败，就不能确信它真的能防止回归。

## When to Use

适用于：
- 新功能
- bug 修复
- 行为变更
- 重构前先补保护测试

可放宽场景：
- 纯文档修改
- 纯配置微调
- 一次性原型且用户明确不要求严格测试

## Cycle

### 1. RED
先写一个最小失败测试，只验证一个行为。

### 2. VERIFY RED
运行该测试，确认：
- 它确实失败
- 失败原因正确
- 不是测试本身写错

### 3. GREEN
写最小代码让测试通过，不顺手加额外能力。

### 4. VERIFY GREEN
再次运行相关测试，确认变绿。

### 5. REFACTOR
只有在测试绿了之后，才做命名、抽取、去重等整理。

## Project-Specific Commands

### 前端
- 定向测试：`npm run test -- <path>`
- 全量单测：`npm run test`
- 构建：`npm run build`

### 端到端或联调相关
- `npm run test:e2e`
- `npm run preview -- --host 127.0.0.1 --port 4173`
- `python scripts/start-workspace-api.py`

## Good Practices

- 一个测试只验证一个行为
- 优先测真实行为，不要只测 mock
- bug 修复先写回归测试
- 如果难以测试，先检查接口设计是不是太复杂

## Common Rationalizations

- “这个太小了，不值得先写测试”
- “我先写实现，等下补测试”
- “我已经手工验证过了”
- “先过功能，回头再补自动化”

这些都容易让测试失去兜底意义。

## Related Reference

如果需要大量 mock、测试工具或怀疑自己在测 mock 而不是真实行为，配合阅读同目录的 `testing-anti-patterns.md`。

## Bottom Line

**先失败、再实现、再验证，才是这个仓库里推荐的 TDD 节奏。**
