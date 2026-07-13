# 企业 SSO 与蓝绿发布说明

## 1. OIDC SSO

### 启用

```env
WORKSPACE_OIDC_ENABLED=true
WORKSPACE_OIDC_ISSUER=https://login.example.com/realms/workbench
WORKSPACE_OIDC_CLIENT_ID=workbench
WORKSPACE_OIDC_CLIENT_SECRET=***
WORKSPACE_OIDC_REDIRECT_URI=https://api.example.com/api/auth/oidc/callback
WORKSPACE_OIDC_SCOPES=openid profile email
# 若 IdP 不支持 discovery，可显式配置：
WORKSPACE_OIDC_AUTHORIZE_URL=
WORKSPACE_OIDC_TOKEN_URL=
WORKSPACE_OIDC_USERINFO_URL=
```

### 流程

1. 前端调用 `GET /api/auth/oidc/status`
2. 点击“企业 SSO 登录” -> `GET /api/auth/oidc/login`
3. 浏览器跳转 IdP 授权
4. IdP 回调 `GET /api/auth/oidc/callback`
5. 后端自动创建/绑定本地用户并签发 JWT

### 账号绑定规则

- 以 `issuer + sub` 作为唯一身份
- 若本地已有同名用户则绑定
- 否则自动注册（首个用户 admin）

## 2. 组织级任务/数据集共享

除模板共享外，现支持：

- `POST /api/orgs/{orgId}/share/resource`
  - `resourceType`: `task` | `dataset` | `template`
  - `resourceId`: 资源 ID（task 可用 `active`）
- `GET /api/orgs/{orgId}/shares`

成员在：

- `/api/datasets` 可见共享数据集
- `/api/history/tasks` 可见共享任务
- `/api/templates` 可见共享模板

前端设置页可直接：

- 共享当前任务为组织模板
- 共享当前任务到组织
- 共享当前数据集到组织

## 3. 结构化资源表

迁移：`0005_structured_resources`

新增表：

- `resource_tasks`
- `resource_datasets`
- `resource_artifacts`
- `org_shares`
- `oidc_identities`

说明：现有 JSON 存储继续兼容；关键写路径会同步写入结构化表，便于后续查询与共享。

## 4. 蓝绿发布

脚本：`tools/blue-green-deploy.sh`

目录约定：

```text
/opt/workbench-prod/
  blue/
  green/
  current -> blue|green
```

本机执行：

```bash
export IMAGE_PREFIX=ghcr.io/<owner>/<repo>
export IMAGE_TAG=v1.2.0
export DEPLOY_ROOT=/opt/workbench-prod
export HEALTH_URL=http://127.0.0.1:8787/api/health/ready
bash tools/blue-green-deploy.sh
```

CD：

- 配置 `PRODUCTION_BLUE_GREEN=true` 时，production 部署 job 使用蓝绿脚本
- 未配置时仍走原 `ssh-deploy.sh`

## 5. 验证清单

- [ ] OIDC status 返回 enabled
- [ ] SSO 登录可拿到 JWT
- [ ] 组织成员可见共享 task/dataset
- [ ] `0005` 迁移可执行
- [ ] 蓝绿切换后 health ready 通过
