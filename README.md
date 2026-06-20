# 多 Agent 协同数据分析创作工作台

这是一个围绕“多 Agent 协同数据分析与报告创作”构建的工作台项目。

项目目标是把数据接入、需求解析、任务流执行、结果可视化、报告编辑和导出串成一条完整工作流，让用户可以在一个界面里完成从原始数据到最终报告的全过程。

## 项目定位

这个项目不是单纯的数据看板，而是一个多 Agent 协同工作台，覆盖以下主链路：

1. 数据源接入
2. 分析需求输入
3. 自然语言意图解析
4. 多 Agent 主流程执行
5. 指标计算与可视化生成
6. 报告编辑
7. 导出与模板沉淀
8. 历史任务复盘与复用

## 当前技术栈

### 前端

- React 19
- TypeScript
- Vite
- React Router DOM
- Zustand
- ECharts

### 后端

- Python
- FastAPI
- Uvicorn

### 数据库

- PostgreSQL

## 当前页面结构

- `/workspace`
  主工作台，多 Agent 主流程
- `/data-sources`
  数据源管理页
- `/templates`
  模板库
- `/workspace-async`
  异步工作台沙箱
- `/history`
  历史任务页

## 多 Agent 主流程

当前工作流中的关键 Agent 节点包括：

1. 数据接入 Agent
2. 数据清洗 Agent
3. 指标计算 Agent
4. 可视化 Agent
5. 洞察分析 Agent
6. 报告生成 Agent
7. 审核校验 Agent

## 本地启动方式

### 前端

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

### 后端

```bash
python scripts/start-workspace-api.py
```

## 默认访问地址

- 前端：`http://127.0.0.1:4173/workspace`
- 后端：`http://127.0.0.1:8787/api/active-task`

## 数据库配置

当前使用 PostgreSQL，连接格式为：

```text
postgresql://postgres:123456@127.0.0.1:5432/workbench
```

## 模型接口

后端当前对接：

- Base URL: `https://apihub.agnes-ai.com/v1`
- Model: `Agnes 2.0 Flash`

## 项目现状

当前项目已经具备可运行的 MVP 版本，包含：

- 工作台前端
- Python 后端 API
- PostgreSQL 接入
- 多页面流程
- 模板与历史任务复用
- 报告编辑与导出流程

## 目录说明

- `src/` 前端源码
- `backend_py/` 后端源码
- `scripts/` 启动脚本
- `tests/` 测试脚本
- `docs/` 设计与实现文档
- `项目总览.md` 项目中文总览文档

## 补充文档

如果要看更完整的中文项目说明，直接阅读：

- `项目总览.md`
- `多Agent协同数据分析.md`
