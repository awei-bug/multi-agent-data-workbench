# 多 Agent 协同数据分析创作工作台

这是一个可运行的多 Agent 数据分析与报告创作工作台，当前版本已经打通了从数据接入、需求解析、工作流执行、图表生成、报告编辑到结果导出的完整主流程。

当前项目定位不是“只有页面原型”，而是“可本地运行、可联调、可继续向企业级推进”的单用户工作台系统。

## 效果演示

[观看演示视频](demo/demo.mp4)

## 主要能力

- 支持上传和解析 `CSV`、`Excel`、`JSON`、`TXT`、`Markdown`、`Word`、`PDF`
- 支持自然语言输入分析需求，并生成结构化意图
- 支持多 Agent 工作流执行
- 支持图表分析、数据洞察、报告编辑与导出
- 支持历史任务保存、模板沉淀、任务回放
- 支持审计事件、健康检查、管理接口保护
- 支持本地账号注册/登录与 JWT 作用域绑定
- 支持 RBAC 角色：viewer / analyst / admin
- 支持异步工作流执行与任务状态轮询
- 支持历史/模板/审计按租户用户列级隔离与索引
- 支持 JSON 结构化日志与 Prometheus `/metrics`
- 支持 Redis 共享工作流队列与独立 worker
- 支持 Sentry 错误追踪与 Webhook 告警
- 支持 CI/CD：测试门禁 + 镜像构建推送（GHCR）
- 支持 Staging 远程自动部署（SSH + compose 健康检查）
- 支持 Redis 共享限流（多实例）
- 支持外部连接器：HTTP JSON / PostgreSQL（凭据加密）
- 支持 Staging 自动部署与 Production 审批部署
- 支持 PostgreSQL、Docker Compose、启动前自动迁移数据库

## 技术栈

### 前端

- React
- TypeScript
- Vite
- ECharts

### 后端

- Python
- FastAPI
- SQLAlchemy
- Alembic
- PostgreSQL / SQLite

### 部署与运行

- Docker
- Docker Compose
- Nginx

## 目录结构

```text
frontend/    前端工作台
backend/     后端服务、迁移、测试
docs/        中文项目文档
tools/       启动、验证脚本
```

## 本地启动

### 方式一：直接本地启动

后端：

```powershell
$env:PYTHONPATH="backend"
python backend/start-workspace-api.py
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5174`
- 后端：`http://127.0.0.1:8787`
- 健康检查：`http://127.0.0.1:8787/api/health`

### 方式二：Docker Compose 启动

```powershell
Copy-Item .env.compose.example .env
docker compose up --build
```

默认地址：

- 前端：`http://127.0.0.1:8080`
- 后端：`http://127.0.0.1:8787`
- PostgreSQL：`127.0.0.1:5432`

## 环境变量

### 根目录 Compose 环境

参考：

- [.env.compose.example](F:/Python_code/多Agent协同数据分析创作工作台/.env.compose.example)

### 后端环境

参考：

- [backend/.env.example](F:/Python_code/多Agent协同数据分析创作工作台/backend/.env.example)

关键变量：

- `WORKSPACE_DATABASE_URL`
- `WORKSPACE_MODEL_BASE_URL`
- `WORKSPACE_MODEL_NAME`
- `WORKSPACE_MODEL_TIMEOUT_SECONDS`
- `WORKSPACE_MODEL_MAX_ATTEMPTS`
- `WORKSPACE_MODEL_TOTAL_TIMEOUT_SECONDS`
- `WORKSPACE_MODEL_BACKOFF_BASE_SECONDS`
- `WORKSPACE_MODEL_BACKOFF_MAX_SECONDS`
- `WORKSPACE_MODEL_CIRCUIT_FAILURE_THRESHOLD`
- `WORKSPACE_MODEL_CIRCUIT_RECOVERY_SECONDS`
- `WORKSPACE_ADMIN_API_KEY`
- `WORKSPACE_AUTH_SECRET`
- `WORKSPACE_AUTH_REQUIRED`
- `WORKSPACE_WORKFLOW_ASYNC`
- `WORKSPACE_JSON_LOGS`
- `WORKSPACE_METRICS_ENABLED`
- `WORKSPACE_QUEUE_BACKEND`
- `WORKSPACE_REDIS_URL`
- `WORKSPACE_QUEUE_VISIBILITY_TIMEOUT_SECONDS`
- `WORKSPACE_QUEUE_MAX_ATTEMPTS`
- `WORKSPACE_SENTRY_DSN`
- `WORKSPACE_ALERT_WEBHOOK_URL`
- `WORKSPACE_RATE_LIMIT_BACKEND`
- `WORKSPACE_CREDENTIALS_SECRET`
- `APIHUB_API_KEY`
- `WORKSPACE_RUN_MIGRATIONS_ON_START`

## 任务执行可靠性

Redis 异步任务和模型调用采用以下保护策略：

- worker 领取任务时才增加一次 `attempts`；lease 超时回收本身不再额外消耗一次重试机会。
- running 任务由独立 heartbeat 续租，默认间隔为 visibility timeout 的三分之一，并限制在 1～30 秒；只有当前 `workerId` 匹配时才允许续租。
- 任务查询会返回 `attempts`、`maxAttempts`、`claimedAt`、`workerId`，便于定位卡住、重试和 worker 漂移问题。
- 模型请求会重试 408、425、429、5xx 和网络传输异常；429 的 `Retry-After` 与指数退避的 full jitter 取更长等待时间。
- `WORKSPACE_MODEL_TIMEOUT_SECONDS` 控制单次请求，`WORKSPACE_MODEL_TOTAL_TIMEOUT_SECONDS` 控制包含重试等待在内的整次调用 deadline。
- 连续可重试失败达到阈值后熔断器进入 open；恢复窗口结束后只允许一个 half-open 探测，成功后恢复 closed。健康检查的 `model.resilience` 会暴露当前配置和熔断状态。
- execution log 的 `at` 使用带 UTC 时区的 ISO 8601 时间，不再写固定占位值。

默认参数：模型最多 2 次请求、总 deadline 120 秒、退避基数 0.5 秒/上限 8 秒、连续 5 次失败熔断、30 秒后探测；Redis visibility timeout 300 秒、任务最多 3 次领取。

更完整的分批加固计划见 `docs/任务执行可靠性加固清单.md`。跨进程 fencing、节点幂等、orphan 对账、DLQ 管理和 LangGraph checkpointer 仍按清单后续批次实施。

### 前端环境

参考：

- [frontend/.env.example](F:/Python_code/多Agent协同数据分析创作工作台/frontend/.env.example)

关键变量：

- `VITE_WORKSPACE_API_BASE_URL`

## 数据库迁移

项目当前支持启动前自动执行 Alembic 迁移。

如果需要手动执行：

```powershell
cd backend
alembic upgrade head
```

## 管理接口保护

当设置 `WORKSPACE_ADMIN_API_KEY` 后，部分敏感接口需要带请求头：

```http
x-admin-api-key: 你的管理口令
```

详情参考：

- [docs/管理接口清单.md](F:/Python_code/多Agent协同数据分析创作工作台/docs/管理接口清单.md)

## 发布与 CD

本地构建并部署预构建镜像：

```powershell
powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Deploy
```

打版本标签触发 GitHub CD：

```bash
git tag v1.0.0
git push origin v1.0.0
```

镜像默认推送到：

```text
ghcr.io/<owner>/<repo>/backend:<tag>
ghcr.io/<owner>/<repo>/frontend:<tag>
```

使用发布 compose：

```powershell
$env:IMAGE_PREFIX="ghcr.io/<owner>/<repo>"
$env:IMAGE_TAG="v1.0.0"
docker compose -f docker-compose.release.yml --env-file .env up -d
```

远程部署到 staging：

```bash
export DEPLOY_HOST=staging.example.com
export DEPLOY_USER=deploy
export DEPLOY_SSH_KEY_PATH=~/.ssh/staging_deploy
export IMAGE_PREFIX=ghcr.io/<owner>/<repo>
export IMAGE_TAG=v1.0.0
bash tools/ssh-deploy.sh
```

Production 审批发布：

```bash
git tag v1.2.0
git push origin v1.2.0
# 然后在 GitHub Environment production 中审批
```

## 项目文档

- [docs/项目总览.md](docs/项目总览.md)
- [docs/用户操作说明.md](docs/用户操作说明.md)
- [docs/企业级部署运行说明.md](docs/企业级部署运行说明.md)
- [docs/持续集成说明.md](docs/持续集成说明.md)
- [docs/持续交付说明.md](docs/持续交付说明.md)
- [docs/远程部署说明.md](docs/远程部署说明.md)
- [docs/生产部署说明.md](docs/生产部署说明.md)
- [docs/上线检查清单.md](docs/上线检查清单.md)
- [docs/管理接口清单.md](docs/管理接口清单.md)

## 验证命令

后端测试：

```powershell
$env:PYTHONPATH="backend"
python -m pytest backend/tests
```

前端测试与构建：

```powershell
cd frontend
npm test
npm run build
```

项目整体验证：

```powershell
powershell -ExecutionPolicy Bypass -File tools\verify-project.ps1
```

## 当前状态

当前项目已经具备：

- 可运行前后端主流程
- 真实文件上传解析
- 图表与报告输出
- PostgreSQL 支持
- 健康探针
- 审计事件
- 管理接口保护骨架
- Docker Compose 编排
- 自动迁移数据库
- JWT 登录/注册、refresh 轮换与会话撤销
- RBAC（viewer / analyst / admin）
- Redis 可靠队列（processing lease / 重试 / 死信）
- 对象存储租户前缀隔离
- 生产安全强制校验与安全响应头
- CI/CD、Staging/Production 发布路径

仍需持续推进的企业级项：

- HttpOnly Cookie / BFF 会话（当前 token 仍在前端存储，已禁止 URL 携带长期 token）
- MFA / SCIM
- Postgres RLS 与字段级分类分级
- 完整设计系统 / i18n / a11y 门禁
- 负载压测与 SLO 告警闭环
- 更细粒度的项目空间与资源 ACL
