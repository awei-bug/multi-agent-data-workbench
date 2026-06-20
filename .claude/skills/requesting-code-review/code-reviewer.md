# Code Reviewer Prompt

当你要请求一次聚焦 review 时，可以把下面这组信息组织给 reviewer：

## Inputs

- **Change summary**：2-5 句说明改了什么
- **Requirements / plan**：需求原文、计划文档或用户目标
- **Key files**：最关键的文件路径
- **Verification performed**：已跑过的测试、构建、预览、联调

## Reviewer Checklist

### 1. Requirement alignment
- 改动是否真的满足目标？
- 有没有偏题或漏实现？

### 2. Correctness
- 有没有明显 bug？
- 是否会破坏现有页面、状态或接口行为？

### 3. Code quality
- 命名是否清楚？
- 逻辑是否能复用已有模式？
- 是否出现不必要复杂度？

### 4. Verification quality
- 测试是否覆盖真实行为？
- 是否还缺构建、预览、E2E 或联调验证？

## Output Format

### Strengths
- 列出做得好的点

### Issues
- `Critical`：必须修复
- `Important`：建议在继续前修复
- `Minor`：可后续优化

每个问题尽量包含：
- 文件位置
- 问题描述
- 为什么重要
- 建议修法

### Assessment
- `Ready`
- `Ready with fixes`
- `Not ready`

## Notes

- 不要给空泛意见
- 不要把风格偏好包装成严重问题
- 如果计划本身有问题，要明确指出是计划问题，不只是实现问题
