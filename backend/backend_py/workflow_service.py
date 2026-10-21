from __future__ import annotations

import asyncio
import json
import re
from copy import deepcopy
from datetime import datetime, timezone
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class WorkflowState(TypedDict):
    task: dict
    action: str


WORKFLOW_NODE_IDS = ["source", "clean", "metric", "chart", "analysis", "report", "audit"]


def _data_source_context(task: dict) -> str:
    data_source = task.get("dataSource") or {}
    preview = data_source.get("textPreview") or json.dumps(data_source.get("previewRows", []), ensure_ascii=False)
    if not preview:
        return ""
    return f"\n文件 {data_source.get('fileName', 'unknown')} 的解析内容：\n{preview[:2000]}"
NODE_CONTEXT_TEMPLATES = {
    "source": {
        "inputSummary": "数据接入 Agent 正在检查需求输入和数据源范围。",
        "outputSummary": "数据接入 Agent 正在整理数据源清单和字段映射。",
    },
    "clean": {
        "inputSummary": "数据清洗 Agent 正在校验原始字段和缺失值。",
        "outputSummary": "数据清洗 Agent 正在输出清洗后的数据草稿。",
    },
    "metric": {
        "inputSummary": "指标计算 Agent 正在汇总核心指标口径。",
        "outputSummary": "指标计算 Agent 正在生成聚合指标结果。",
    },
    "chart": {
        "inputSummary": "可视化 Agent 正在筛选适合的图表结构。",
        "outputSummary": "可视化 Agent 正在准备趋势图和对比图。",
    },
    "analysis": {
        "inputSummary": "洞察分析 Agent 正在审查指标、趋势和异常。",
        "outputSummary": "洞察分析 Agent 正在撰写归因结论。",
    },
    "report": {
        "inputSummary": "报告生成 Agent 正在收集已确认的发现和图表。",
        "outputSummary": "报告生成 Agent 正在生成叙事化总结。",
    },
    "audit": {
        "inputSummary": "审核校验 Agent 正在复核导出前的最终内容。",
        "outputSummary": "审核校验 Agent 正在确认报告和图表引用一致。",
    },
}


def _clone_nodes(nodes: list[dict]) -> list[dict]:
    return [dict(node) for node in nodes]


def _get_running_node(nodes: list[dict]) -> dict | None:
    for node in nodes:
        if node["status"] == "running":
            return node
    return None


def _get_failed_node(nodes: list[dict]) -> dict | None:
    for node in nodes:
        if node["status"] == "failed":
            return node
    return None


def _get_running_node_index(nodes: list[dict]) -> int | None:
    for index, node in enumerate(nodes):
        if node["status"] == "running":
            return index
    return None


def _context_for_label(base_context: dict, label: str, latest_log: str, risks: list[str] | None = None) -> dict:
    return {
        **base_context,
        "activeAgent": label,
        "latestLog": latest_log,
        "risks": risks or base_context["risks"],
    }


def _context_for_node(base_context: dict, node: dict, latest_log: str, risks: list[str] | None = None) -> dict:
    node_context = _context_for_label(base_context, node["label"], latest_log, risks)
    template = NODE_CONTEXT_TEMPLATES.get(
        node["id"],
        {
            "inputSummary": f"{node['label']} 正在等待上游交接。",
            "outputSummary": f"{node['label']} 尚未产生输出。",
        },
    )
    return {
        **node_context,
        "inputSummary": template["inputSummary"],
        "outputSummary": template["outputSummary"],
    }


def create_execution_log_entry(kind: str, message: str) -> dict:
    return {
        "at": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "message": message,
    }


def _apply_workflow_action(task: dict, action: str) -> dict:
    updated = deepcopy(task)
    snapshot = updated["snapshot"]
    nodes = snapshot["nodes"]
    base_context = snapshot["context"]

    if action == "start":
        next_nodes = _clone_nodes(nodes)
        next_nodes[0]["status"] = "running"
        snapshot["nodes"] = next_nodes
        snapshot["phase"] = "running"
        snapshot["logMessage"] = f"{next_nodes[0]['label']} 执行中"
        snapshot["context"] = _context_for_node(base_context, next_nodes[0], snapshot["logMessage"])
    elif action == "pause":
        running_node = _get_running_node(nodes)
        if running_node:
            snapshot["phase"] = "paused"
            snapshot["logMessage"] = f"已暂停在 {running_node['label']}"
            snapshot["context"] = _context_for_label(base_context, running_node["label"], f"{running_node['label']} 已暂停")
    elif action == "resume":
        running_node = _get_running_node(nodes)
        if running_node:
            snapshot["phase"] = "running"
            snapshot["logMessage"] = f"{running_node['label']} 执行中"
            snapshot["context"] = _context_for_node(base_context, running_node, snapshot["logMessage"])
    elif action == "retry":
        return apply_workflow_action(updated, "start")
    elif action == "fail":
        running_node = _get_running_node(nodes) or nodes[0]
        snapshot["nodes"] = [
            {**node, "status": "failed" if node["id"] == running_node["id"] else node["status"]}
            for node in nodes
        ]
        snapshot["phase"] = "failed"
        snapshot["logMessage"] = f"{running_node['label']} 执行失败"
        snapshot["context"] = _context_for_label(
            base_context,
            running_node["label"],
            f"{running_node['label']} 执行失败",
            ["当前节点执行失败，需要人工复核后再继续。"],
        )
    elif action == "retry_current":
        failed_node = _get_failed_node(nodes) or nodes[0]
        snapshot["nodes"] = [
            {
                **node,
                "status": "running" if node["id"] == failed_node["id"] else ("pending" if node["status"] != "success" else "success"),
            }
            for node in nodes
        ]
        snapshot["phase"] = "running"
        snapshot["logMessage"] = f"{failed_node['label']} 正在重试"
        snapshot["context"] = _context_for_node(base_context, failed_node, snapshot["logMessage"])
    elif action == "stop":
        snapshot["phase"] = "stopped"
        snapshot["logMessage"] = "任务已终止"
        snapshot["context"] = _context_for_label(base_context, "任务已终止", snapshot["logMessage"])

    updated["status"] = {
        "running": "执行中",
        "paused": "已暂停",
        "failed": "执行失败",
        "stopped": "已终止",
        "idle": "等待启动",
    }.get(snapshot["phase"], updated["status"])
    updated["risks"] = snapshot["context"]["risks"]
    return updated


def _workflow_node(state: WorkflowState) -> WorkflowState:
    return {
        "task": _apply_workflow_action(state["task"], state["action"]),
        "action": state["action"],
    }


def build_workflow_graph():
    graph = StateGraph(WorkflowState)
    for node_id in WORKFLOW_NODE_IDS:
        graph.add_node(node_id, _workflow_node)
    graph.add_edge(START, WORKFLOW_NODE_IDS[0])
    for current_node, next_node in zip(WORKFLOW_NODE_IDS, WORKFLOW_NODE_IDS[1:]):
        graph.add_edge(current_node, next_node)
    graph.add_edge(WORKFLOW_NODE_IDS[-1], END)
    return graph.compile()


def apply_workflow_action(task: dict, action: str) -> dict:
    graph = build_workflow_graph()
    result = graph.invoke({"task": task, "action": action})
    return result["task"]


def _document_text(data_source: dict) -> str:
    return str(data_source.get("fullText") or data_source.get("textPreview") or "").strip()


def _document_profile(data_source: dict) -> dict:
    profile = data_source.get("profile") or {}
    text = _document_text(data_source)
    if profile.get("keywords"):
        return profile
    lines = [line for line in text.splitlines() if line.strip()]
    words = re.findall(r"[\w一-鿿]+", text)
    token_counts: dict[str, int] = {}
    for token in words:
        key = token.lower()
        if len(key) < 2 or key.isdigit():
            continue
        token_counts[key] = token_counts.get(key, 0) + 1
    keywords = sorted(token_counts.items(), key=lambda item: item[1], reverse=True)[:20]
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", text) if part.strip()] or lines
    return {
        "charCount": len(text),
        "wordCount": len(words),
        "lineCount": len(lines),
        "paragraphCount": len(paragraphs),
        "keywords": [{"term": term, "count": count} for term, count in keywords],
        "sampleParagraphs": paragraphs[:8],
    }


def _is_document_source(data_source: dict) -> bool:
    return (data_source.get("kind") == "document") or bool(_document_text(data_source) and not (data_source.get("analysisRows") or data_source.get("columns")))


def _extract_request_focus(request_text: str) -> list[str]:
    tokens = re.findall(r"[\w一-鿿]{2,}", request_text or "")
    stop = {"分析", "总结", "报告", "输出", "生成", "请", "帮我", "内容", "文件", "数据", "进行", "一个", "这份", "本文", "文档"}
    result = []
    for token in tokens:
        if token in stop:
            continue
        if token not in result:
            result.append(token)
        if len(result) >= 8:
            break
    return result


def _document_findings(request_text: str, data_source: dict) -> dict:
    profile = _document_profile(data_source)
    text = _document_text(data_source)
    focus = _extract_request_focus(request_text)
    paragraphs = profile.get("sampleParagraphs") or [line for line in text.splitlines() if line.strip()][:8]
    keywords = profile.get("keywords") or []
    evidence = []
    for paragraph in paragraphs:
        score = sum(1 for item in focus if item.lower() in paragraph.lower())
        if score > 0 or not focus:
            evidence.append({"text": paragraph[:240], "score": score})
    evidence.sort(key=lambda item: item["score"], reverse=True)
    if not evidence and paragraphs:
        evidence = [{"text": paragraph[:240], "score": 0} for paragraph in paragraphs[:5]]
    top_keywords = "、".join(item["term"] for item in keywords[:8]) or "未识别"
    focus_text = "、".join(focus) or "全文主题"
    summary = (
        f"文档《{data_source.get('fileName', '未命名')}》共 {profile.get('charCount', 0)} 字、"
        f"{profile.get('paragraphCount', 0)} 段。围绕“{focus_text}”，高频主题包括：{top_keywords}。"
    )
    if evidence:
        summary += f" 关键证据：{evidence[0]['text']}"
    return {
        "summary": summary,
        "focus": focus,
        "keywords": keywords[:12],
        "evidence": evidence[:5],
        "profile": profile,
    }


def _numeric_value(value: object) -> float | None:
    try:
        normalized = str(value or "").replace(",", "").strip()
        result = float(normalized)
        return result if result == result and abs(result) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _deterministic_node_output(node: dict, task: dict) -> dict:
    data_source = task.get("dataSource") or {}
    rows = data_source.get("analysisRows") or []
    columns = data_source.get("columns") or []
    scope = data_source.get("analysisScope") or {"mode": "full", "rowCount": len(rows), "rowsProcessed": len(rows)}
    artifact = {"nodeId": node["id"], "label": node["label"], "scope": scope}
    is_document = _is_document_source(data_source)
    request_text = str(task.get("request") or "")

    if node["id"] == "source":
        artifact["type"] = "source_profile"
        if is_document:
            profile = _document_profile(data_source)
            artifact["content"] = {
                "fileName": data_source.get("fileName"),
                "kind": "document",
                "charCount": profile.get("charCount", 0),
                "wordCount": profile.get("wordCount", 0),
                "paragraphCount": profile.get("paragraphCount", 0),
                "profile": profile,
            }
        else:
            artifact["content"] = {
                "fileName": data_source.get("fileName"),
                "rowCount": data_source.get("rowCount", len(rows)),
                "columns": columns,
                "profile": data_source.get("profile", {}),
            }
    elif node["id"] == "clean":
        if is_document:
            text = _document_text(data_source)
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            normalized = "\n".join(lines)
            data_source = {
                **data_source,
                "textPreview": normalized[:4000],
                "fullText": normalized[:100_000],
                "rowCount": len(lines),
                "profile": _document_profile({**data_source, "fullText": normalized, "textPreview": normalized[:4000]}),
                "analysisScope": {
                    **(data_source.get("analysisScope") or {}),
                    "mode": "full" if len(normalized) <= 100_000 else "sampled",
                    "rowCount": len(lines),
                    "rowsProcessed": len(lines),
                },
            }
            task["dataSource"] = data_source
            artifact["type"] = "cleaning_summary"
            artifact["content"] = {
                "rowsRetained": len(lines),
                "rowsInput": len(text.splitlines()),
                "changes": ["去除空行", "统一段落空白", f"保留有效文本 {len(normalized)} 字"],
            }
        else:
            profile = data_source.get("profile") or {}
            cleaned_rows: list[dict[str, str]] = []
            dropped_empty = 0
            trimmed_cells = 0
            seen_keys: set[tuple[str, ...]] = set()
            duplicate_dropped = 0
            headers = [column.get("name") for column in columns if column.get("name")] or (list(rows[0].keys()) if rows else [])
            for row in rows:
                cleaned = {}
                empty = True
                for header in headers:
                    raw = str(row.get(header, ""))
                    value = raw.strip()
                    if value != raw:
                        trimmed_cells += 1
                    if value:
                        empty = False
                    cleaned[header] = value
                if empty:
                    dropped_empty += 1
                    continue
                key = tuple(cleaned.get(header, "") for header in headers)
                if key in seen_keys:
                    duplicate_dropped += 1
                    continue
                seen_keys.add(key)
                cleaned_rows.append(cleaned)
            data_source = {
                **data_source,
                "analysisRows": cleaned_rows,
                "previewRows": cleaned_rows[:100],
                "rowCount": len(cleaned_rows),
                "analysisScope": {
                    **(data_source.get("analysisScope") or {}),
                    "rowsProcessed": len(cleaned_rows),
                    "rowCount": data_source.get("analysisScope", {}).get("rowCount", len(rows)),
                    "mode": data_source.get("analysisScope", {}).get("mode", "full"),
                },
            }
            task["dataSource"] = data_source
            artifact["type"] = "cleaning_summary"
            artifact["content"] = {
                "rowsRetained": len(cleaned_rows),
                "rowsInput": len(rows),
                "nullCounts": profile.get("nullCounts", {}),
                "duplicateRows": profile.get("duplicateRows", 0),
                "duplicateDropped": duplicate_dropped,
                "droppedEmptyRows": dropped_empty,
                "trimmedCells": trimmed_cells,
                "changes": [
                    f"去除空白行 {dropped_empty} 条",
                    f"去除重复行 {duplicate_dropped} 条",
                    f"裁剪单元格空白 {trimmed_cells} 处",
                    "保留原始数值，未自动填补缺失值。",
                ],
            }
    elif node["id"] == "metric":
        if is_document:
            findings = _document_findings(request_text, data_source)
            keywords = findings.get("keywords") or []
            ranked = [{"name": item["term"], "value": item["count"]} for item in keywords]
            artifact["type"] = "metric_result"
            artifact["content"] = {
                "dimension": "主题词",
                "metric": "出现次数",
                "metrics": ["出现次数"],
                "groups": ranked,
                "total": sum(item["value"] for item in ranked),
                "recordCount": findings.get("profile", {}).get("wordCount", 0),
                "averages": {"出现次数": (sum(item["value"] for item in ranked) / len(ranked) if ranked else 0)},
                "analysisMode": "document",
                "focus": findings.get("focus", []),
            }
        else:
            intent = task.get("intent") or {}
            numeric_fields = [column.get("name") for column in columns if column.get("type") == "number" and column.get("name")]
            non_numeric = [column.get("name") for column in columns if column.get("name") and column.get("name") not in numeric_fields]
            requested_metrics = [item.strip() for item in str(intent.get("metrics") or "").replace("、", ",").split(",") if item.strip()]
            requested_dimensions = [item.strip() for item in str(intent.get("dimensions") or "").replace("、", ",").split(",") if item.strip()]
            metric_fields = [field for field in requested_metrics if field in numeric_fields] or numeric_fields[:3]
            dimension = next((field for field in requested_dimensions if field in non_numeric), None) or (non_numeric[0] if non_numeric else None)
            metric = metric_fields[0] if metric_fields else None
            groups: dict[str, dict[str, float]] = {}
            if dimension and metric_fields:
                for row in rows:
                    name = str(row.get(dimension, "")).strip()
                    if not name:
                        continue
                    bucket = groups.setdefault(name, {field: 0.0 for field in metric_fields} | {"__count": 0.0})
                    bucket["__count"] += 1
                    for field in metric_fields:
                        value = _numeric_value(row.get(field))
                        if value is not None:
                            bucket[field] += value
            ranked = []
            for name, bucket in groups.items():
                entry = {"name": name, "count": int(bucket.get("__count", 0))}
                for field in metric_fields:
                    entry[field] = bucket.get(field, 0.0)
                entry["value"] = bucket.get(metric, 0.0) if metric else 0.0
                ranked.append(entry)
            ranked.sort(key=lambda item: item.get("value", 0), reverse=True)
            artifact["type"] = "metric_result"
            artifact["content"] = {
                "dimension": dimension,
                "metric": metric,
                "metrics": metric_fields,
                "groups": ranked,
                "total": sum(item.get("value", 0) for item in ranked),
                "recordCount": len(rows),
                "averages": {
                    field: (sum(item.get(field, 0) for item in ranked) / len(ranked) if ranked else 0)
                    for field in metric_fields
                },
                "analysisMode": "table",
            }
    elif node["id"] == "chart":
        metric_artifact = next((item for item in reversed(task.get("artifacts", [])) if item.get("type") == "metric_result"), {})
        metric_content = metric_artifact.get("content", {})
        artifact["type"] = "chart_spec"
        artifact["content"] = {
            "title": f"{metric_content.get('metric') or '指标'} 分组排名",
            "dimension": metric_content.get("dimension"),
            "metric": metric_content.get("metric"),
            "series": metric_content.get("groups", []),
            "analysisMode": metric_content.get("analysisMode", "table"),
        }
    elif node["id"] == "analysis":
        if is_document:
            findings = _document_findings(request_text, data_source)
            artifact["type"] = "analysis"
            artifact["content"] = {"summary": findings["summary"], "evidence": findings, "analysisMode": "document"}
        else:
            metric_artifact = next((item for item in reversed(task.get("artifacts", [])) if item.get("type") == "metric_result"), {})
            groups = metric_artifact.get("content", {}).get("groups", [])
            summary = "未识别到可汇总的数值字段。"
            if groups:
                leader = groups[0]
                summary = f"{leader['name']} 的汇总值最高，为 {leader['value']:.2f}。"
                if len(groups) > 1:
                    summary += f" 共比较 {len(groups)} 个分组。"
            artifact["type"] = "analysis"
            artifact["content"] = {"summary": summary, "evidence": metric_artifact.get("content", {}), "analysisMode": "table"}
    elif node["id"] == "report":
        analysis_artifact = next((item for item in reversed(task.get("artifacts", [])) if item.get("type") == "analysis"), {})
        metric_artifact = next((item for item in reversed(task.get("artifacts", [])) if item.get("type") == "metric_result"), {})
        analysis = analysis_artifact.get("content", {}).get("summary", "暂无分析结论。")
        metric = metric_artifact.get("content", {})
        if is_document:
            evidence = (analysis_artifact.get("content", {}).get("evidence") or {}).get("evidence") or []
            keywords = metric.get("groups") or []
            lines = [
                f"# {task.get('name', '分析报告')}",
                "",
                f"数据源：{data_source.get('fileName', '未绑定')}",
                "分析模式：文档理解",
                f"分析范围：{scope.get('rowsProcessed', data_source.get('rowCount', 0))}/{scope.get('rowCount', data_source.get('rowCount', 0))} 段/行（{scope.get('mode', 'full')}）",
                "",
                "## 执行摘要",
                analysis,
                "",
                "## 高频主题",
            ]
            lines.extend(f"{index}. {item.get('name')}: {item.get('value')}" for index, item in enumerate(keywords[:20], 1))
            if evidence:
                lines.extend(["", "## 关键证据"])
                lines.extend(f"{index}. {item.get('text')}" for index, item in enumerate(evidence[:5], 1))
        else:
            lines = [
                f"# {task.get('name', '分析报告')}",
                "",
                f"数据源：{data_source.get('fileName', '未绑定')}",
                f"分析范围：{scope.get('rowsProcessed', len(rows))}/{scope.get('rowCount', len(rows))} 行（{scope.get('mode', 'full')}）",
                "",
                "## 执行摘要",
                analysis,
            ]
            if metric.get("groups"):
                lines.extend(["", f"## {metric.get('dimension')} 按 {metric.get('metric')} 汇总"])
                lines.extend(f"{index}. {item['name']}: {item['value']}" for index, item in enumerate(metric["groups"][:20], 1))
        artifact["type"] = "report_markdown"
        artifact["content"] = {"markdown": "\n".join(lines), "analysisMode": "document" if is_document else "table"}
    else:
        warnings = []
        if scope.get("mode") != "full":
            warnings.append("当前分析使用抽样或受限范围，导出时必须保留范围说明。")
        profile = data_source.get("profile") or {}
        if profile.get("duplicateRows"):
            warnings.append(f"检测到 {profile['duplicateRows']} 条重复记录，尚未自动删除。")
        if is_document and not _document_text(data_source):
            warnings.append("文档未提取到有效文本，结论可信度有限。")
        artifact["type"] = "audit"
        artifact["content"] = {
            "warnings": warnings,
            "status": "needs_review" if warnings else "completed",
            "analysisMode": "document" if is_document else "table",
        }
    return artifact


async def _generate_node_output(node: dict, task: dict, chat_client) -> str:
    if node["id"] == "analysis":
        prompt = f"请根据以下需求和文件内容，输出简洁的中文分析发现摘要：\n{task.get('request', '')}{_data_source_context(task)}"
        return await chat_client.complete(prompt)
    if node["id"] == "report":
        prompt = f"请根据以下需求和文件内容，输出简洁的中文报告摘要：\n{task.get('request', '')}{_data_source_context(task)}"
        return await chat_client.complete(prompt)
    return task["summary"]


def advance_workflow_with_model(task: dict, chat_client) -> dict:
    updated = deepcopy(task)
    snapshot = updated["snapshot"]
    nodes = _clone_nodes(snapshot["nodes"])
    running_index = _get_running_node_index(nodes)

    if running_index is None:
        return updated

    running_node = nodes[running_index]
    artifact = _deterministic_node_output(running_node, updated)
    if running_node["id"] in {"analysis", "report"} and chat_client and getattr(chat_client, "api_key", True):
        try:
            model_output = asyncio.run(_generate_node_output(running_node, updated, chat_client))
            if model_output.strip():
                if running_node["id"] == "analysis":
                    artifact["content"]["summary"] = model_output
                else:
                    artifact["content"]["markdown"] = model_output
        except Exception as error:
            artifact.setdefault("warnings", []).append(f"模型不可用，已使用确定性结果：{error}")

    updated.setdefault("artifacts", []).append(artifact)
    nodes[running_index]["status"] = "success"

    if running_index + 1 < len(nodes):
        next_node = nodes[running_index + 1]
        nodes[running_index + 1]["status"] = "running"
        snapshot["phase"] = "running"
        snapshot["logMessage"] = f"{next_node['label']} 执行中"
        snapshot["context"] = _context_for_node(snapshot["context"], next_node, snapshot["logMessage"])
        updated["status"] = "执行中"
    else:
        audit = artifact.get("content", {})
        snapshot["phase"] = audit.get("status", "completed")
        snapshot["logMessage"] = f"{running_node['label']} 已完成"
        snapshot["context"] = _context_for_node(snapshot["context"], running_node, snapshot["logMessage"], audit.get("warnings") or snapshot["context"].get("risks"))
        updated["status"] = "等待人工复核" if snapshot["phase"] == "needs_review" else "已完成"

    report = next((item for item in reversed(updated["artifacts"]) if item.get("type") == "report_markdown"), None)
    analysis = next((item for item in reversed(updated["artifacts"]) if item.get("type") == "analysis"), None)
    # 用 .get() 而不是下标：任务可能是新构造的 dict（例如由 data_hub 连接器直接生成、
    # 或外部流程拼装），不带 summary 键。用下标会让整个工作流在最后一步崩掉，
    # 而这一步前面的产物都白跑了。
    current_summary = updated.get("summary")
    if report:
        updated["summary"] = report.get("content", {}).get("markdown", current_summary)
    elif analysis:
        updated["summary"] = analysis.get("content", {}).get("summary", current_summary)
    snapshot["nodes"] = nodes
    updated["snapshot"] = snapshot
    updated["risks"] = snapshot["context"]["risks"]
    return updated
