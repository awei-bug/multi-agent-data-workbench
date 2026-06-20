from __future__ import annotations

import asyncio
from copy import deepcopy
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class WorkflowState(TypedDict):
    task: dict
    action: str


WORKFLOW_NODE_IDS = ["source", "clean", "metric", "chart", "analysis", "report", "audit"]
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
        "at": "now",
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


async def _generate_node_output(node: dict, task: dict, chat_client) -> str:
    if node["id"] == "analysis":
        prompt = f"请根据以下需求，输出简洁的中文分析发现摘要：\n{task.get('request', '')}"
        return await chat_client.complete(prompt)
    if node["id"] == "report":
        prompt = f"请根据以下需求，输出简洁的中文报告摘要：\n{task.get('request', '')}"
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
    model_output = asyncio.run(_generate_node_output(running_node, updated, chat_client))
    nodes[running_index]["status"] = "success"

    if running_index + 1 < len(nodes):
        next_node = nodes[running_index + 1]
        nodes[running_index + 1]["status"] = "running"
        snapshot["phase"] = "running"
        snapshot["logMessage"] = f"{next_node['label']} 执行中"
        snapshot["context"] = _context_for_node(snapshot["context"], next_node, snapshot["logMessage"])
    else:
        next_node = running_node
        snapshot["phase"] = "done"
        snapshot["logMessage"] = f"{running_node['label']} 已完成"
        snapshot["context"] = _context_for_node(snapshot["context"], running_node, snapshot["logMessage"])

    snapshot["nodes"] = nodes
    updated["summary"] = model_output
    updated["snapshot"] = snapshot
    updated["risks"] = snapshot["context"]["risks"]
    return updated
