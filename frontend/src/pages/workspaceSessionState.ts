import type { ExecutionPhase, WorkflowSnapshot } from '../mock/mockTaskEngine';
import type { ExportRecord, TaskDataSourceRecord } from '../types/tasks';

export type SessionUpdate = {
  name?: string;
  mode?: 'live' | 'replay';
  status?: string;
  summary?: string;
  request?: string;
  snapshot?: WorkflowSnapshot;
  exports?: ExportRecord[];
  risks?: string[];
  dataSource?: TaskDataSourceRecord;
};

export const TASK_STATUS = {
  idle: '\u7b49\u5f85\u542f\u52a8',
  running: '\u6267\u884c\u4e2d',
  paused: '\u5df2\u6682\u505c',
  completed: '\u5f85\u5bfc\u51fa',
  failed: '\u6267\u884c\u5931\u8d25',
  stopped: '\u5df2\u7ec8\u6b62',
} as const;

export function mergeSummaryEntries(currentSummary: string, nextEntry: string, replacePrefix?: string) {
  const parts = currentSummary
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== nextEntry)
    .filter((item) => (replacePrefix ? !item.startsWith(replacePrefix) : true));

  return [nextEntry, ...parts].slice(0, 4).join('\n');
}

export function deriveTaskStatus(phase: ExecutionPhase, fallback: string) {
  if (phase === 'running') return TASK_STATUS.running;
  if (phase === 'paused') return TASK_STATUS.paused;
  if (phase === 'completed') return TASK_STATUS.completed;
  if (phase === 'failed') return TASK_STATUS.failed;
  if (phase === 'stopped') return TASK_STATUS.stopped;

  return fallback;
}
