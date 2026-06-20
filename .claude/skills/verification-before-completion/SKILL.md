---
name: verification-before-completion
description: Use when about to claim a task is complete, a bug is fixed, tests pass, or a feature works.
---

# Verification Before Completion

## Overview

在这个项目里，完成声明必须建立在**刚刚运行过的验证证据**之上，而不是建立在“看起来应该行”之上。

**核心原则：** 先验证，再宣称。

## When to Use

适用于任何即将出现这些表达的时刻：
- “已经修好了”
- “测试都过了”
- “构建成功了”
- “可以交付了”
- “这个页面现在能用了”

## The Gate

在做任何正向结论前，按这个顺序检查：

1. **Identify**：哪条命令才能证明这句话？
2. **Run**：立刻运行完整命令
3. **Read**：确认退出状态、失败数、关键输出
4. **Match**：输出是否真的支持你的声明？
5. **State**：只在证据成立时再下结论

## Project-Specific Verification Ladder

### 前端单点改动
优先顺序：
1. `npm run test -- <相关测试文件>`
2. `npm run test`
3. `npm run build`

### 页面或交互链路改动
必要时继续补：
1. `npm run preview -- --host 127.0.0.1 --port 4173`
2. 手工打开对应页面验证关键路径

### 端到端流程改动
必要时继续补：
1. `npm run test:e2e`
2. `python scripts/start-workspace-api.py`
3. 与预览前端联调

### 后端或接口相关改动
- 运行相关后端测试或最小复现命令
- 必要时启动 `python scripts/start-workspace-api.py` 做接口验证

## Examples

### Good
- “`npm run build` 已通过，本次构建成功。”
- “`npm run test -- src/foo.test.ts` 通过，相关回归已验证。”
- “预览服务已启动，并手工验证了 `/workspace` 主链路。”

### Bad
- “应该已经修好了。”
- “我看代码没问题，算完成。”
- “单测大概率会过。”
- “构建应该没问题，因为类型看起来对。”

## Red Flags

一旦出现这些念头，停下来先验证：
- “先说完成，等下再补跑”
- “这改动很小，不用测”
- “上次跑过了，这次应该也一样”
- “agent 说成功了，那应该就成功了”

## Minimum Standard

- 声称测试通过 → 至少跑对应测试
- 声称构建成功 → 必须跑 `npm run build`
- 声称功能可用 → 至少做对应层级的运行验证
- 声称联调通过 → 必须有前后端实际运行证据

## Bottom Line

**没有新鲜验证证据，就不要做完成性结论。**
