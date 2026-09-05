from __future__ import annotations

import json
import logging

from fastapi.responses import JSONResponse

from backend_py.repository import TaskRepository
from backend_py.security import security_headers

logger = logging.getLogger("workspace_api")


def audit(repo: TaskRepository, action: str, target: str, payload: dict | None = None) -> None:
    repo.add_audit_event(action, target, payload)


def add_security_headers(response, *, enable_hsts: bool = False, csp: str | None = None) -> None:
    for key, value in security_headers(enable_hsts=enable_hsts, csp=csp).items():
        response.headers[key] = value


def error_response(
    request_id: str,
    status_code: int,
    code: str,
    message: str,
    details: dict | None = None,
    extra_headers: dict[str, str] | None = None,
    *,
    enable_hsts: bool = False,
    csp: str | None = None,
):
    response = JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
            },
            "requestId": request_id,
        },
    )
    response.headers["x-request-id"] = request_id
    if extra_headers:
        for key, value in extra_headers.items():
            response.headers[key] = value
    add_security_headers(response, enable_hsts=enable_hsts, csp=csp)
    return response


def data_source_context(data_source: dict | None) -> str:
    if not data_source:
        return ""
    preview = data_source.get("textPreview") or json.dumps(data_source.get("previewRows", []), ensure_ascii=False)
    if not preview:
        return ""
    return f"\nUploaded file: {data_source.get('fileName', 'unknown')}\nContent preview:\n{preview[:2000]}"


def field_names(data_source: dict | None, preferred_type: str | None = None) -> list[str]:
    columns = (data_source or {}).get("columns") or []
    names = []
    for column in columns:
        if preferred_type and column.get("type") != preferred_type:
            continue
        name = column.get("name")
        if name:
            names.append(name)
    return names


def build_agentic_intent(request_text: str, data_source: dict | None, model_payload: dict | None = None) -> dict:
    data_source = data_source or {}
    is_document = data_source.get("kind") == "document" or bool(data_source.get("textPreview") and not data_source.get("columns"))
    numeric_fields = field_names(data_source, "number")
    all_fields = field_names(data_source)
    metrics = model_payload.get("metrics") if model_payload else None
    dimensions = model_payload.get("dimensions") if model_payload else None
    charts = model_payload.get("charts") if model_payload else None

    if is_document:
        keywords = ((data_source.get("profile") or {}).get("keywords") or [])
        keyword_terms = [item.get("term") for item in keywords if item.get("term")]
        return {
            "request": request_text,
            "goal": (model_payload or {}).get("goal") or request_text,
            "metrics": metrics or "主题词频、证据匹配度、段落覆盖",
            "dimensions": dimensions or ", ".join(keyword_terms[:5]) or "章节、主题、风险点",
            "charts": charts or "主题词频柱状图、关键证据列表",
            "analysisMode": "document",
            "agents": [
                {"id": "source", "name": "数据接入 Agent", "output": "读取文档文本与基础画像"},
                {"id": "clean", "name": "文本清洗 Agent", "output": "清理空行并规范化段落"},
                {"id": "metric", "name": "主题提取 Agent", "output": "提取高频主题与关注点"},
                {"id": "chart", "name": "可视化 Agent", "output": "生成主题词频图"},
                {"id": "analysis", "name": "洞察分析 Agent", "output": "输出文档结论与证据"},
                {"id": "report", "name": "报告生成 Agent", "output": "生成文档分析报告"},
                {"id": "audit", "name": "结果校验 Agent", "output": "检查证据与范围说明"},
            ],
            "roleViews": {
                "business": "自然语言文档结论",
                "analyst": "主题词、证据段落与文本画像",
                "manager": "管理层决策简报",
            },
            "assets": ["文档画像", "主题词", "证据段落", "报告版本"],
            "schedule": "可对同类文档做定期复盘并输出主题变化",
        }

    return {
        "request": request_text,
        "goal": (model_payload or {}).get("goal") or request_text,
        "metrics": metrics or ", ".join(numeric_fields[:3]) or "自动识别核心数值指标",
        "dimensions": dimensions or ", ".join([field for field in all_fields if field not in numeric_fields][:3]) or "自动识别可比较维度",
        "charts": charts or "排名柱状图、占比环图、多指标雷达图",
        "analysisMode": "table",
        "agents": [
            {"id": "orchestrator", "name": "总调度 Agent", "output": "拆解需求、分派任务、汇总校验结论"},
            {"id": "source", "name": "数据接入 Agent", "output": "读取上传文件和数据源元信息"},
            {"id": "clean", "name": "数据清洗治理 Agent", "output": "识别缺失、重复、类型异常和口径风险"},
            {"id": "metric", "name": "指标计算 Agent", "output": "生成分组汇总、排名和对比指标"},
            {"id": "mining", "name": "挖掘建模 Agent", "output": "识别异常波动、集中度和潜在归因"},
            {"id": "chart", "name": "可视化 Agent", "output": "选择并生成对比图表"},
            {"id": "report", "name": "报告生成 Agent", "output": "输出业务版、管理版和技术版报告"},
            {"id": "audit", "name": "结果校验 Agent", "output": "交叉校验指标、图表和报告引用一致性"},
        ],
        "roleViews": {
            "business": "自然语言分析结论",
            "analyst": "SQL/Python 复用逻辑",
            "manager": "管理层决策简报",
        },
        "assets": ["分析模板", "清洗规则", "指标口径", "图表配置", "报告版本"],
        "schedule": "可接入定时巡检任务，按固定周期复跑同一分析目标并生成异常预警",
    }
