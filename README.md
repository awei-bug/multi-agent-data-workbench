# 多 Agent 协同数据分析创作工作台

这是一个可运行的多 Agent 数据分析与报告创作工作台。系统把数据源接入、自然语言需求解析、Agent 流程执行、图表分析、报告编辑、模板复用和导出串成一条完整工作流。

## 技术栈

- 前端：React 19、TypeScript、Vite、React Router、Zustand、ECharts
- 后端：Python、FastAPI、Uvicorn
- 数据库：PostgreSQL
- 大模型接口：`https://apihub.agnes-ai.com/v1`
- 工程化：Docker Compose、GitHub Actions、前后端自动化测试

## 目录结构

```text
frontend/   前端项目：页面、组件、样式、前端测试和构建配置
backend/    Python 后端：FastAPI 服务、仓储层、Agent 工作流和后端测试
tools/      本地启动、检查和验证脚本
docs/       项目中文说明、需求文档和数据库迁移说明
README.md   项目入口说明
```

## 本地启动

推荐使用统一启动脚本：

```powershell
powershell -ExecutionPolicy Bypass -File tools\start-workspace.ps1
```

默认访问地址：

- 前端工作台：`http://127.0.0.1:5174/workspace`
- 后端健康检查：`http://127.0.0.1:8787/api/health`

启动前需要准备 `.env`：

```powershell
Copy-Item .env.example .env
```

然后在 `.env` 中填写可用的模型密钥，并确认 PostgreSQL 连接地址可用。

## Docker Compose 启动

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Docker Compose 会启动 PostgreSQL、Python 后端和前端静态服务。

## 核心环境变量

- `AGNES_API_KEY` / `OPENAI_API_KEY` / `APIHUB_API_KEY`：模型密钥，三者任意一个可用即可。
- `WORKSPACE_DATABASE_URL`：PostgreSQL 连接串。
- `WORKSPACE_MODEL_TIMEOUT_SECONDS`：模型调用超时时间，默认 `60`。
- `WORKSPACE_MAX_REQUEST_BODY_BYTES`：请求体大小限制。
- `WORKSPACE_RATE_LIMIT_PER_MINUTE`：接口限流阈值。
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

## 主要工作流

1. 用户接入 CSV 数据或加载系统内置样例数据。
2. 用户输入自然语言分析需求。
3. 后端调用大模型解析分析意图。
4. 多 Agent 流程依次完成数据清洗、指标计算、可视化、洞察分析、报告生成和审核校验。
5. 前端展示数据预览、图表、运行日志和报告草稿。
6. 用户编辑报告后导出，或保存为可复用模板。

## 已落地能力

- 前后端分离架构，支持本地脚本和 Docker Compose 启动。
- PostgreSQL 持久化和 Alembic 数据库迁移。
- 大模型调用失败分类、超时、重试和日志记录。
- 多 Agent 任务节点状态、失败提示和重试入口。
- 前端路由、工作台主流程、图表预览、报告编辑、模板和历史页面。
- GitHub Actions 自动运行后端测试、前端测试和前端生产构建。

## 相关文档

- [项目总览](docs/项目总览.md)
- [数据库迁移](docs/数据库迁移.md)
- [多 Agent 协同数据分析](docs/多Agent协同数据分析.md)
