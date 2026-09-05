import type { TaskRecord } from '../types/tasks';

export type WorkspaceStage = 'input' | 'execution' | 'output';

export type StageGate = {
  allowed: boolean;
  reason: string;
  redirectTo: WorkspaceStage;
  ctaLabel: string;
  ctaPath?: string;
};

export type StageReadiness = {
  hasDataSource: boolean;
  hasIntent: boolean;
  isRunning: boolean;
  isFailed: boolean;
  isCompleted: boolean;
  isPaused: boolean;
  isStopped: boolean;
  phase: string;
};

const PLACEHOLDER_REQUESTS = new Set(['', '尚未填写分析需求。', '请填写分析需求。']);

export function hasMeaningfulRequest(task: TaskRecord, intent?: { request?: string; goal?: string } | null): boolean {
  if (intent?.goal?.trim() || intent?.request?.trim()) return true;
  const request = String(task.request || '').trim();
  if (!request) return false;
  return !PLACEHOLDER_REQUESTS.has(request);
}

export function getStageReadiness(
  task: TaskRecord,
  intent?: { request?: string; goal?: string } | null,
): StageReadiness {
  const phase = String(task.snapshot?.phase || 'idle');
  const execStatus = String(task.execution?.status || '');
  return {
    hasDataSource: Boolean(task.dataSource),
    hasIntent: hasMeaningfulRequest(task, intent),
    isRunning: phase === 'running' || execStatus === 'running' || execStatus === 'queued',
    isFailed: phase === 'failed' || execStatus === 'failed',
    isCompleted: phase === 'completed' || phase === 'needs_review',
    isPaused: phase === 'paused',
    isStopped: phase === 'stopped' || execStatus === 'cancelled',
    phase,
  };
}

export function evaluateStageAccess(
  stage: WorkspaceStage,
  task: TaskRecord,
  intent?: { request?: string; goal?: string } | null,
): StageGate {
  const readiness = getStageReadiness(task, intent);

  if (stage === 'execution') {
    if (!readiness.hasDataSource) {
      return {
        allowed: false,
        reason: '开始分析前要先有数据。请先上传或选择一份文件。',
        redirectTo: 'input',
        ctaLabel: '去上传数据',
        ctaPath: '/data-sources',
      };
    }
    if (!readiness.hasIntent && !readiness.isRunning && !readiness.isFailed && !readiness.isCompleted && !readiness.isPaused) {
      return {
        allowed: false,
        reason: '还没有写清楚要分析什么。请先填写问题并生成分析方案。',
        redirectTo: 'input',
        ctaLabel: '返回说明问题',
      };
    }
  }

  if (stage === 'output') {
    if (!readiness.hasDataSource) {
      return {
        allowed: false,
        reason: '当前还没有数据，无法查看结果。',
        redirectTo: 'input',
        ctaLabel: '去上传数据',
        ctaPath: '/data-sources',
      };
    }
    if (!readiness.isCompleted && !readiness.isFailed && !readiness.isStopped) {
      if (readiness.isRunning || readiness.isPaused) {
        return {
          allowed: false,
          reason: '还在分析中。请先完成或停止当前分析，再查看结果。',
          redirectTo: 'execution',
          ctaLabel: '查看分析进度',
        };
      }
      return {
        allowed: false,
        reason: '还没有结果可看。请先开始并完成分析。',
        redirectTo: readiness.hasIntent ? 'execution' : 'input',
        ctaLabel: readiness.hasIntent ? '去开始分析' : '返回说明问题',
      };
    }
  }

  return {
    allowed: true,
    reason: '',
    redirectTo: stage,
    ctaLabel: '',
  };
}

export function canEnterStage(
  stage: WorkspaceStage,
  task: TaskRecord,
  intent?: { request?: string; goal?: string } | null,
): boolean {
  return evaluateStageAccess(stage, task, intent).allowed;
}

/** Soft unlock: allow reviewing completed/failed output even without re-parse. */
export function stageLockHint(
  stage: WorkspaceStage,
  task: TaskRecord,
  intent?: { request?: string; goal?: string } | null,
): string | null {
  const gate = evaluateStageAccess(stage, task, intent);
  return gate.allowed ? null : gate.reason;
}
