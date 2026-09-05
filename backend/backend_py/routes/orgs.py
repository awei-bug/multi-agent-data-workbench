from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, FastAPI, HTTPException, Request

from backend_py.api_helpers import audit
from backend_py.app_context import AppContext
from backend_py.auth import ROLE_ADMIN, ROLE_ANALYST, hash_password
from backend_py.oidc import (
    OidcError,
    build_authorize_url,
    create_pkce_pair,
    exchange_code_for_tokens,
    fetch_userinfo,
    normalize_oidc_profile,
)
from backend_py.repository import reset_workspace_scope, set_workspace_scope
from backend_py.schemas import (
    InviteAcceptRequest,
    OrganizationCreateRequest,
    OrganizationInviteRequest,
    OrganizationMemberRoleRequest,
    OrganizationShareResourceRequest,
    OrganizationShareTemplateRequest,
)


def register_org_routes(app: FastAPI, ctx: AppContext) -> None:
    router = APIRouter(tags=["orgs"])

    def _require_org_manager(org_id: str, user_id: str) -> dict:
        org = ctx.repo.get_organization(org_id)
        if not org:
            raise HTTPException(status_code=404, detail="organization not found")
        member = ctx.repo.get_organization_member(org_id, user_id)
        if not member or member.get("status") != "active":
            raise HTTPException(status_code=403, detail="not an organization member")
        if member.get("role") not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="organization admin role required")
        return org

    def _require_org_member(org_id: str, user_id: str) -> dict:
        org = ctx.repo.get_organization(org_id)
        if not org:
            raise HTTPException(status_code=404, detail="organization not found")
        member = ctx.repo.get_organization_member(org_id, user_id)
        if not member or member.get("status") != "active":
            raise HTTPException(status_code=403, detail="not an organization member")
        return org

    @router.get("/api/orgs")
    def list_orgs(request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None and ctx.auth_required:
            raise HTTPException(status_code=401, detail="authentication required")
        user_id = auth_user.id if auth_user else ctx.default_user_id
        tenant_id = auth_user.tenant_id if auth_user else ctx.default_tenant_id
        items = ctx.repo.list_organizations_for_user(user_id, tenant_id)
        return {"items": items}

    @router.post("/api/orgs")
    def create_org(payload: OrganizationCreateRequest, request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        name = (payload.name or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="organization name too short")
        raw_slug = (payload.slug or name).strip().lower()
        slug = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in raw_slug).strip("-_")
        if len(slug) < 2:
            raise HTTPException(status_code=400, detail="organization slug invalid")
        try:
            org = ctx.repo.create_organization(
                name=name,
                slug=slug,
                owner_user_id=auth_user.id,
                tenant_id=auth_user.tenant_id,
            )
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        audit(ctx.repo, "org.create", org["id"], {"name": name, "slug": slug})
        return {"organization": org}

    @router.get("/api/orgs/{org_id}")
    def get_org(org_id: str, request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        org = _require_org_member(org_id, auth_user.id)
        members = ctx.repo.list_organization_members(org_id)
        invites = ctx.repo.list_organization_invites(org_id)
        return {
            "organization": org,
            "members": members,
            "invites": [item for item in invites if item.get("status") == "pending"],
            "me": ctx.repo.get_organization_member(org_id, auth_user.id),
        }

    @router.post("/api/orgs/{org_id}/invites")
    def invite_org_member(org_id: str, payload: OrganizationInviteRequest, request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        _require_org_manager(org_id, auth_user.id)
        username = (payload.username or "").strip().lower()
        if len(username) < 3:
            raise HTTPException(status_code=400, detail="username invalid")
        role = (payload.role or "member").strip().lower()
        if role not in {"admin", "member", "viewer"}:
            raise HTTPException(status_code=400, detail="role must be admin/member/viewer")
        invite = ctx.repo.create_organization_invite(
            org_id=org_id,
            username=username,
            role=role,
            created_by=auth_user.id,
        )
        audit(ctx.repo, "org.invite", org_id, {"username": username, "role": role, "inviteId": invite["id"]})
        return {"invite": invite}

    @router.post("/api/orgs/invites/accept")
    def accept_org_invite(payload: InviteAcceptRequest, request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        try:
            member = ctx.repo.accept_organization_invite(
                token=(payload.token or "").strip(),
                user_id=auth_user.id,
                username=auth_user.username,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        audit(ctx.repo, "org.invite.accept", member.get("orgId", ""), {"userId": auth_user.id})
        return {"member": member}

    @router.patch("/api/orgs/{org_id}/members/{user_id}")
    def update_org_member_role(org_id: str, user_id: str, payload: OrganizationMemberRoleRequest, request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        org = _require_org_manager(org_id, auth_user.id)
        role = (payload.role or "").strip().lower()
        if role not in {"admin", "member", "viewer"}:
            raise HTTPException(status_code=400, detail="role must be admin/member/viewer")
        if user_id == org.get("ownerUserId"):
            raise HTTPException(status_code=400, detail="cannot change organization owner role")
        updated = ctx.repo.update_organization_member_role(org_id, user_id, role)
        if not updated:
            raise HTTPException(status_code=404, detail="member not found")
        audit(ctx.repo, "org.member.role_update", org_id, {"userId": user_id, "role": role})
        return {"member": updated}

    @router.delete("/api/orgs/{org_id}/members/{user_id}")
    def remove_org_member(org_id: str, user_id: str, request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        org = _require_org_manager(org_id, auth_user.id)
        if user_id == org.get("ownerUserId"):
            raise HTTPException(status_code=400, detail="cannot remove organization owner")
        removed = ctx.repo.remove_organization_member(org_id, user_id)
        if not removed:
            raise HTTPException(status_code=404, detail="member not found")
        audit(ctx.repo, "org.member.remove", org_id, {"userId": user_id})
        return {"removed": True, "userId": user_id}

    @router.post("/api/orgs/{org_id}/share/template")
    def share_template_to_org(org_id: str, payload: OrganizationShareTemplateRequest, request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        _require_org_member(org_id, auth_user.id)
        templates = ctx.repo.list_templates()
        template = None
        if payload.templateId:
            template = next((item for item in templates if item.get("id") == payload.templateId), None)
        if template is None:
            active = ctx.repo.get_active_task()
            template = {
                "name": active.get("name") or "组织共享模板",
                "description": (active.get("summary") or "").split("\n")[0] or "来自工作台会话的组织共享模板",
                "request": active.get("request") or "",
                "summary": active.get("summary") or "",
                "tag": "组织共享",
            }
        shared = ctx.repo.share_template_to_org(org_id=org_id, template=template)
        audit(ctx.repo, "org.template.share", org_id, {"templateId": shared.get("id"), "name": shared.get("name")})
        return {"template": shared}


    @router.get("/api/auth/oidc/status")
    def oidc_status() -> dict:
        return {
            "enabled": bool(ctx.oidc_settings.enabled),
            "issuer": ctx.oidc_settings.issuer if ctx.oidc_settings.enabled else "",
        }

    @router.get("/api/auth/oidc/login")
    def oidc_login() -> dict:
        if not ctx.oidc_settings.enabled:
            raise HTTPException(status_code=404, detail="oidc disabled")
        state = uuid4().hex
        verifier, challenge = create_pkce_pair()
        ctx.oidc_state_store.put(
            state,
            {"verifier": verifier, "createdAt": datetime.now(timezone.utc).isoformat()},
            ttl_seconds=600,
        )
        try:
            url = build_authorize_url(ctx.oidc_settings, state=state, code_challenge=challenge)
        except OidcError as error:
            raise HTTPException(status_code=400, detail=error.message) from error
        return {"authorizeUrl": url, "state": state}

    @router.get("/api/auth/oidc/callback")
    def oidc_callback(code: str = "", state: str = "") -> dict:
        if not ctx.oidc_settings.enabled:
            raise HTTPException(status_code=404, detail="oidc disabled")
        meta = ctx.oidc_state_store.pop(state) if state else None
        if not code or not state or not meta:
            raise HTTPException(status_code=400, detail="invalid oidc state")
        try:
            tokens = exchange_code_for_tokens(
                ctx.oidc_settings,
                code=code,
                code_verifier=str(meta.get("verifier") or ""),
            )
            access_token = str(tokens.get("access_token") or "")
            if not access_token:
                raise OidcError("access_token missing in token response", "oidc_token_failed")
            profile_raw = fetch_userinfo(ctx.oidc_settings, access_token)
            profile = normalize_oidc_profile(profile_raw, default_tenant=ctx.default_tenant_id)
            user = ctx.repo.get_user_by_oidc(issuer=ctx.oidc_settings.issuer, subject=profile["subject"])
            if user is None:
                existing = ctx.repo.get_user_by_username(profile["username"])
                if existing:
                    user = existing
                else:
                    tenant_id = profile["tenantId"] or ctx.default_tenant_id
                    role = ROLE_ADMIN if len(ctx.repo.list_users(tenant_id=tenant_id)) == 0 else ROLE_ANALYST
                    user = ctx.repo.create_user(
                        username=profile["username"],
                        password_hash=hash_password(uuid4().hex + "Aa1!"),
                        tenant_id=tenant_id,
                        display_name=profile["displayName"],
                        role=role,
                    )
                ctx.repo.link_oidc_identity(
                    user_id=user["id"],
                    issuer=ctx.oidc_settings.issuer,
                    subject=profile["subject"],
                    email=profile.get("email"),
                )
            token_payload = ctx.issue_token_for_user(user)
            audit(ctx.repo, "auth.oidc.login", user["id"], {"issuer": ctx.oidc_settings.issuer, "subject": profile["subject"]})
            return token_payload
        except OidcError as error:
            raise HTTPException(status_code=400, detail=error.message) from error

    @router.post("/api/orgs/{org_id}/share/resource")
    def share_resource_to_org(org_id: str, payload: OrganizationShareResourceRequest, request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        _require_org_member(org_id, auth_user.id)
        resource_type = (payload.resourceType or "").strip().lower()
        if resource_type not in {"task", "dataset", "template"}:
            raise HTTPException(status_code=400, detail="resourceType must be task/dataset/template")
        resource_id = (payload.resourceId or "").strip()
        resource_payload = None
        if resource_type == "template":
            templates = ctx.repo.list_templates()
            resource_payload = next((item for item in templates if item.get("id") == resource_id), None) if resource_id else None
            if resource_payload is None:
                active = ctx.repo.get_active_task()
                resource_payload = {
                    "id": f"template-from-active-{uuid4().hex[:8]}",
                    "name": active.get("name") or "组织共享模板",
                    "description": (active.get("summary") or "").split("\n")[0] or "组织共享模板",
                    "request": active.get("request") or "",
                    "summary": active.get("summary") or "",
                    "tag": "组织共享",
                    "source": "organization",
                }
                resource_id = resource_payload["id"]
                ctx.repo.share_template_to_org(org_id=org_id, template=resource_payload)
            else:
                ctx.repo.share_template_to_org(org_id=org_id, template=resource_payload)
        elif resource_type == "dataset":
            datasets = ctx.repo.list_datasets()
            resource_payload = next((item for item in datasets if item.get("id") == resource_id), None)
            if resource_payload is None:
                raise HTTPException(status_code=404, detail="dataset not found")
            ctx.repo.upsert_resource_dataset(resource_payload, org_id=org_id)
        else:
            if resource_id in {"", "active", "current"}:
                resource_payload = ctx.repo.get_active_task()
                resource_id = str(resource_payload.get("id") or "workspace-active-session")
            else:
                resource_payload = next((item for item in ctx.repo.list_recent_tasks() if item.get("id") == resource_id), None)
            if resource_payload is None:
                raise HTTPException(status_code=404, detail="task not found")
            ctx.repo.upsert_resource_task(resource_payload, org_id=org_id)
        permission = (payload.permission or "read").strip().lower()
        if permission not in {"read", "write"}:
            permission = "read"
        share = ctx.repo.create_org_share(
            org_id=org_id,
            resource_type=resource_type,
            resource_id=resource_id,
            shared_by=auth_user.id,
            permission=permission,
            payload=resource_payload or {},
        )
        audit(ctx.repo, "org.resource.share", org_id, {"resourceType": resource_type, "resourceId": resource_id})
        return {"share": share}

    @router.get("/api/orgs/{org_id}/shares")
    def list_org_shares(org_id: str, request: Request, resourceType: str | None = None) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        _require_org_member(org_id, auth_user.id)
        items = ctx.repo.list_org_shares(org_id, resource_type=(resourceType or None))
        return {"items": items}


    app.include_router(router)
