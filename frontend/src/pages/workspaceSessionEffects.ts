import type { ExecutionPhase, WorkflowSnapshot } from '../mock/mockTaskEngine';
import { deriveTaskStatus, TASK_STATUS, type SessionUpdate } from './workspaceSessionState';

export function buildActiveTaskSyncUpdate(update: { snapshot?: WorkflowSnapshot; summary?: string }) {
  if (update.snapshot) {
    return { snapshot: update.snapshot } satisfies SessionUpdate;
  }

  return { summary: update.summary } satisfies SessionUpdate;
}

export function shouldStartRunningTimer(phase: ExecutionPhase) {
  return phase === 'running';
}

export function buildRunningTickUpdate(nextSnapshot: WorkflowSnapshot) {
  return {
    snapshot: nextSnapshot,
    status: deriveTaskStatus(nextSnapshot.phase, TASK_STATUS.running),
    risks: nextSnapshot.context.risks,
  } satisfies SessionUpdate;
}
