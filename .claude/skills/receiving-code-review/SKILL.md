---
name: receiving-code-review
description: Use when receiving review feedback before implementing the suggested changes.
---

# Receiving Code Review

## Overview

收到 review 意见后，不要先表态，不要先认同，也不要先改。先理解、再核对、再决定怎么处理。

**核心原则：** 技术核实优先于礼貌性附和。

## Response Pattern

1. **Read**：完整读完反馈，不要只盯其中一句
2. **Understand**：用自己的话复述问题；不清楚就提问
3. **Verify**：去代码里核对这个意见是否适用于当前仓库
4. **Evaluate**：判断它是必须修、可选优化，还是不适用
5. **Implement**：按优先级逐条处理
6. **Verify again**：每一类修复做相应验证

## When to Pause and Ask

出现以下情况时，不要直接改：
- 反馈描述太模糊
- 多条反馈互相关联，但其中几条你没理解
- 建议可能与当前架构约束冲突
- 建议可能会破坏已有行为
- 建议和用户已经表达的意图相冲突

这时先澄清，而不是“先改明白的部分再说”。

## How to Evaluate Feedback

### 来自用户/你本人当前任务上下文的反馈
- 默认优先处理
- 如果范围不清楚，先问清楚
- 不需要做表演式认同，直接说明理解或开始处理

### 来自外部 reviewer / 自动 review 的反馈
先核对：
- 对当前代码路径是否成立？
- 是否和现有行为冲突？
- 是否只是理想化建议，不适合这个仓库当前阶段？
- 是否已经被测试覆盖证明当前实现可接受？

## YAGNI Check

如果 review 建议你“补一个更完整、更专业”的能力，先查：
- 这个能力当前真的被调用吗？
- 当前需求里真的需要它吗？
- 加进去会不会引入不必要复杂度？

如果没有实际使用场景，优先提出 YAGNI 疑问，而不是盲加。

## Suggested Handling Order

1. 先处理会导致错误结果、失败测试、构建问题、安全问题的项
2. 再处理缺失行为或明显不稳健的项
3. 最后处理命名、结构、可读性、轻量优化项

## Good Responses

- “已确认这个问题存在，准备修复。”
- “我理解你的意思是要避免这里的空状态泄漏，我先核对调用方再改。”
- “这个建议和当前 `/workspace-async` 的实际链路不一致，我先说明原因。”

## Bad Responses

- “你说得太对了！”
- “好建议，我马上全改。”
- “虽然我还没核对，但应该是这个问题。”

## Verification After Applying Feedback

改完后，按反馈类型选择验证：
- 测试问题 → 跑相关测试
- 构建问题 → 跑 `npm run build`
- 页面行为问题 → 预览 + 手工验证
- 流程问题 → 必要时跑 E2E 或联调

## Bottom Line

**review 反馈是需要技术判断的输入，不是自动执行指令。**
