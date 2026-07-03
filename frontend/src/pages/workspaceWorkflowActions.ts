import type { WorkflowSnapshot } from '../mock/mockTaskEngine';
import { buildPauseSummary } from './workspaceSessionCopy';

type WorkflowActionResult = {
  snapshot: WorkflowSnapshot;
  summaryEntry: string;
};

function getRunningNodeLabel(snapshot: WorkflowSnapshot) {
  return snapshot.nodes.find((node) => node.status === 'running')?.label ?? snapshot.nodes[0]?.label ?? '';
}

function getFailedNodeLabel(snapshot: WorkflowSnapshot) {
  return snapshot.nodes.find((node) => node.status === 'failed')?.label ?? snapshot.nodes[0]?.label ?? '';
}

export function buildStartAction(snapshot: WorkflowSnapshot): WorkflowActionResult {
  return {
    snapshot,
    summaryEntry: '已启动多 Agent 执行流程。',
  };
}

export function buildPauseAction(snapshot: WorkflowSnapshot): WorkflowActionResult {
  return {
    snapshot,
    summaryEntry: buildPauseSummary(getRunningNodeLabel(snapshot)),
  };
}

export function buildResumeAction(snapshot: WorkflowSnapshot): WorkflowActionResult {
  return {
    snapshot,
    summaryEntry: '已恢复当前执行流程。',
  };
}

export function buildRetryAction(snapshot: WorkflowSnapshot): WorkflowActionResult {
  return {
    snapshot,
    summaryEntry: '已从首节点重新启动执行流程。',
  };
}

export function buildFailAction(snapshot: WorkflowSnapshot): WorkflowActionResult {
  return {
    snapshot,
    summaryEntry: `流程在 ${getRunningNodeLabel(snapshot)} 失败，等待人工处理。`,
  };
}

export function buildRetryCurrentAction(snapshot: WorkflowSnapshot): WorkflowActionResult {
  return {
    snapshot,
    summaryEntry: `已对 ${getFailedNodeLabel(snapshot)} 发起单节点重试。`,
  };
}

export function buildStopAction(snapshot: WorkflowSnapshot): WorkflowActionResult {
  return {
    snapshot,
    summaryEntry: '任务已终止，保留当前中间产物供人工检查。',
  };
}
