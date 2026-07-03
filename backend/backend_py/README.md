# 后端模块说明

这里是工作台的 Python 后端源码目录，负责提供 FastAPI 接口、任务数据持久化、多 Agent 工作流推进和大模型调用。

从 `backend/` 目录启动：

```powershell
py -m pip install -r requirements.txt
$env:WORKSPACE_DATABASE_URL="postgresql://postgres:123456@127.0.0.1:5432/workbench"
py start-workspace-api.py
```

默认端口：`8787`。

后端优先使用 `WORKSPACE_DATABASE_URL` 指向的 PostgreSQL；如果未配置该环境变量，会回退到本地 `workspace.sqlite3`，但正式演示建议使用 PostgreSQL。
