---
name: systematic-debugging
description: Use when debugging bugs, failing tests, build failures, or unexpected behavior before proposing fixes.
---

# Systematic Debugging

## Overview

不要先猜修复方案。先搞清楚问题是怎么发生的、在哪一层发生的、为什么发生。

**核心原则：** 先定位根因，再动手修。

## When to Use

适用于：
- 单测失败
- 构建失败
- 页面行为异常
- 前后端联调异常
- 状态同步、异步流程、数据流问题

## Four Phases

### 1. Root Cause Investigation
先做这些事：
- 认真读错误输出和堆栈
- 用最小步骤稳定复现
- 看最近改动和相关 diff
- 确认问题发生在哪一层：页面、状态、路由、接口、后端、数据

如果是多层链路问题，优先在边界处加证据，而不是直接改实现。

### 2. Pattern Analysis
- 找一个工作正常的相邻实现
- 对比“正常”和“异常”的差异
- 看它依赖了哪些状态、参数、环境或调用顺序

### 3. Hypothesis and Test
- 明确写出一个假设：我认为根因是 X，因为 Y
- 一次只验证一个假设
- 不要把多个修复一起塞进去

### 4. Implementation
- 能写测试就先写失败测试
- 只修根因，不顺手扩散重构
- 修完立刻跑最小验证

## Project-Specific Guidance

### 前端问题
优先检查：
- 相关组件测试
- Zustand store / selector
- router 切换
- mock 数据与真实 API 桥接
- `src/` 是否出现异常产物或路径误判

### 构建问题
优先运行：
- `npm run build`

### 单测问题
优先运行：
- `npm run test -- <相关测试文件>`

### 页面链路问题
必要时运行：
- `npm run preview -- --host 127.0.0.1 --port 4173`

### 前后端联调问题
必要时同时启动：
- `npm run preview -- --host 127.0.0.1 --port 4173`
- `python scripts/start-workspace-api.py`

## Red Flags

出现这些迹象时，说明你在乱修：
- “先随便试个改动看看”
- “这应该就是原因”
- “先改三处再跑一次”
- “不用复现，直接按经验修”
- “虽然没看懂，但这个改法大概率行”

## Related References

同目录补充技巧：
- `root-cause-tracing.md`
- `condition-based-waiting.md`
- `defense-in-depth.md`

## Bottom Line

**没有根因定位，就不要直接给修复方案。**
