# 多 Agent 协同数据分析创作工作台

这是一个围绕“多 Agent 协同数据分析与报告创作”构建的可运行工作台。系统把数据源接入、需求输入、Agent 流程执行、图表分析、报告编辑、模板复用和导出串成一条完整工作流。

## 技术栈

- 前端：React 19、TypeScript、Vite、React Router DOM、Zustand、ECharts
- 后端：Python、FastAPI、Uvicorn
- 数据库：PostgreSQL
- 大模型接口：`https://apihub.agnes-ai.com/v1`

## 目录结构

```text
frontend/   前端项目，包含页面、组件、样式、前端测试和前端依赖
backend/    Python 后端项目，包含 FastAPI 服务、仓储层、Agent 工作流逻辑和后端测试
tools/      本地启动与辅助脚本
docs/       项目中文说明、需求文档和总览文档
README.md   项目入口说明
```

## 本地启动

推荐直接使用统一启动脚本：

```powershell
powershell -ExecutionPolicy Bypass -File tools\start-workspace.ps1
```

如果需要本地环境文件，复制 `.env.example` 为 `.env` 后修改密钥和数据库连接。启动脚本会自动读取根目录 `.env`。

默认访问地址：

- 前端：`http://127.0.0.1:5174/workspace`
- 后端健康检查：`http://127.0.0.1:8787/api/health`

## Docker Compose 启动

先准备环境变量：

```powershell
Copy-Item .env.example .env
```

把 `.env` 里的 `AGNES_API_KEY` 改成真实模型密钥后执行：

```powershell
docker compose up --build
```

Docker Compose 会启动 PostgreSQL、Python 后端和前端静态服务。

## 单独启动

前端：

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5174
```

后端：

```powershell
cd backend
py -m pip install -r requirements.txt
$env:WORKSPACE_DATABASE_URL="postgresql://postgres:123456@127.0.0.1:5432/workbench"
py start-workspace-api.py
```

## 关键环境变量

- `AGNES_API_KEY` / `OPENAI_API_KEY` / `APIHUB_API_KEY`：模型密钥，三者任一可用。
- `WORKSPACE_DATABASE_URL`：PostgreSQL 连接串。
- `WORKSPACE_MODEL_TIMEOUT_SECONDS`：模型调用超时时间，默认 `60`。
- `WORKSPACE_ENABLE_AUDIT_EVENTS`：是否开放审计事件接口，默认 `true`。
- `WORKSPACE_CORS_ORIGINS`：允许访问后端的前端地址，多个地址用英文逗号分隔。

## 验证命令

一键验证：

```powershell
powershell -ExecutionPolicy Bypass -File tools\verify-project.ps1
```

已启动服务巡检：

```powershell
powershell -ExecutionPolicy Bypass -File tools\check-system.ps1
```

后端：

```powershell
cd backend
py -m unittest tests.test_workspace_api tests.test_workflow_service
```

前端：

```powershell
cd frontend
npm run build
```

GitHub Actions 会在推送到 `main` 或创建 Pull Request 时自动执行后端测试和前端构建。

## 核心流程

1. 数据源接入或加载系统生成的经营样例数据。
2. 输入自然语言分析需求。
3. 后端调用大模型解析分析意图。
4. 多 Agent 流程依次完成数据清洗、指标计算、可视化、洞察分析、报告生成和审核校验。
5. 前端展示图表、数据表格、运行日志和报告草稿。
6. 用户编辑报告后导出或保存为模板。

## 详细文档

- [项目总览](docs/项目总览.md)
- [原始需求说明](docs/多Agent协同数据分析.md)
