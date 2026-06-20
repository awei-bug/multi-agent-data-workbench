# Condition-Based Waiting

异步测试或异步流程出问题时，优先等待**条件成立**，不要盲等固定时间。

## 推荐

- 等待具体文本出现
- 等待状态变为某个值
- 等待某个 Promise / 事件完成
- 等待 DOM 或接口结果进入可断言状态

## 避免

- 大量 `setTimeout` / 固定 sleep
- 仅靠延长超时掩盖真实竞态

## 在本仓库中的应用

- Vitest / Testing Library 里优先使用可观察条件
- Playwright 里等待页面状态或元素状态，而不是生硬暂停
- 多 Agent / 异步工作台流程里等待任务状态变化，而不是猜执行时间
