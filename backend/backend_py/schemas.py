from __future__ import annotations

from pydantic import BaseModel


class IntentRequest(BaseModel):
    request: str = ""
    dataSource: dict | None = None


class ActiveTaskUpdate(BaseModel):
    name: str | None = None
    mode: str | None = None
    status: str | None = None
    summary: str | None = None
    request: str | None = None
    intent: dict | None = None
    snapshot: dict | None = None
    exports: list[dict] | None = None
    risks: list[str] | None = None
    dataSource: dict | None = None


class WorkflowActionRequest(BaseModel):
    action: str


class TemplateDraftRequest(BaseModel):
    name: str | None = None
    request: str | None = None
    summary: str | None = None


class DataSourceIngestRequest(BaseModel):
    fileName: str
    contentBase64: str
    mimeType: str | None = None


class ExportRequest(BaseModel):
    format: str
    report: str | None = None


class TaskCorrectionRequest(BaseModel):
    summary: str


class AuthRegisterRequest(BaseModel):
    username: str
    password: str
    tenantId: str | None = None
    displayName: str | None = None


class AuthLoginRequest(BaseModel):
    username: str
    password: str


class AuthRefreshRequest(BaseModel):
    refreshToken: str | None = None


class AuthLogoutRequest(BaseModel):
    refreshToken: str | None = None


class AuthPasswordResetRequest(BaseModel):
    username: str


class AuthPasswordResetConfirm(BaseModel):
    token: str
    newPassword: str


class RoleUpdateRequest(BaseModel):
    role: str


class OrganizationCreateRequest(BaseModel):
    name: str
    slug: str | None = None


class OrganizationInviteRequest(BaseModel):
    username: str
    role: str = "member"


class OrganizationMemberRoleRequest(BaseModel):
    role: str


class OrganizationShareTemplateRequest(BaseModel):
    templateId: str | None = None


class InviteAcceptRequest(BaseModel):
    token: str


class OrganizationShareResourceRequest(BaseModel):
    resourceType: str
    resourceId: str | None = None
    permission: str = "read"


class ConnectionUpsertRequest(BaseModel):
    name: str
    connectorType: str
    config: dict = {}
    credentials: dict | None = None


class ConnectionTestRequest(BaseModel):
    connectorType: str | None = None
    config: dict | None = None
    credentials: dict | None = None


class ConnectionImportRequest(BaseModel):
    datasetName: str | None = None


class SmartScrapeRequest(BaseModel):
    url: str
    instruction: str
    datasetName: str | None = None
    outputFormat: str | None = None  # csv | md | json
    bearerToken: str | None = None
    allowPrivateHosts: bool = False
    startAnalysis: bool = False
    # If false, only preview extraction/file without importing into datasets.
    commit: bool = True
    # Optional headless browser rendering for JS-heavy pages.
    renderJs: bool = False


class SmartScrapeCommitRequest(BaseModel):
    """Commit a previously generated scrape payload into datasets."""
    url: str
    instruction: str
    datasetName: str | None = None
    outputFormat: str | None = None
    # Client sends back the generated file/content from preview.
    fileName: str
    mimeType: str
    format: str
    contentBase64: str
    kind: str | None = None
    extractionMeta: dict | None = None
    # Optional structured rows/text so import does not need to re-scrape.
    rows: list[dict] | None = None
    text: str | None = None
    paragraphs: list[str] | None = None
    # Optional field projection for table imports.
    selectedFields: list[str] | None = None
    # Optional row projection (indexes into preview rows / full rows).
    selectedRowIndexes: list[int] | None = None
    startAnalysis: bool = False
