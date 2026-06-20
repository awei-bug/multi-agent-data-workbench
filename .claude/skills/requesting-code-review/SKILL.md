---
name: requesting-code-review
description: Use when preparing a focused code review request after a meaningful change or before merge.
---

# Requesting Code Review

## Overview

在提交较大改动、复杂修复、跨文件功能，或者准备合并前，先把 review 请求组织清楚，让 reviewer 聚焦真正重要的内容。

**核心原则：** 给 reviewer 足够上下文，但不要把 review 变成漫无边际的代码浏览。

## When to Use

适用于：
- 完成一个明显的功能块之后
- 修完复杂 bug 之后
- 计划 merge 前
- 想让另一个视角检查需求对齐和代码质量时

## What to Prepare

至少准备这四类信息：

1. **What changed**
- 用 2-5 句说明本次改动做了什么

2. **Why it changed**
- 说明需求、bug、计划文档或用户目标

3. **Where to review**
- 点名关键文件
- 如果有明确 diff 范围，也指出基线与当前头部

4. **How it was verified**
- 列出你已经跑过的测试、构建、预览或联调步骤

## Suggested Review Focus

请 reviewer 重点看：
- 是否满足需求
- 是否引入明显 bug 或遗漏边界条件
- 是否和现有架构模式一致
- 是否有可复用/可简化空间
- 验证是否充分

## Project-Specific Review Checklist

发起 review 前，至少检查：
- 是否有相关测试或解释为什么没有
- 是否需要 `npm run build`
- 是否需要预览验证 `/workspace`、`/workspace-async`、`/history` 等路径
- 是否涉及 `scripts/start-workspace-api.py` 联调
- 是否与已有 `docs/superpowers/plans/` 一致

## Review Request Template

可直接按这个结构组织：

- 变更摘要：本次新增/修复了什么
- 需求来源：对应的用户要求、issue 或计划文档
- 关键文件：列出最值得看的路径
- 验证结果：列出已完成验证
- 希望重点关注：例如正确性、边界条件、架构一致性

更细的 reviewer 提示词可参考同目录的 `code-reviewer.md`。

## Bottom Line

**好的 review 请求，会让 reviewer 更快发现真正的问题。**
