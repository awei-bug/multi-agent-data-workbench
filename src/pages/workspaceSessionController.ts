import type { WorkflowSnapshot } from '../mock/mockTaskEngine';
import type { ExportRecord } from '../types/tasks';
import { EMPTY_REQUEST, DEFAULT_REQUEST } from './workspaceSessionCopy';
import { buildExportTaskStatus } from './workspaceSessionCopy';
import { deriveTaskStatus, mergeSummaryEntries, type SessionUpdate } from './workspaceSessionState';

type BuildSummarySessionStateArgs = {
  currentSummary: string;
  nextEntry: string;
  replacePrefix?: string;
};

type BuildSnapshotSessionStateArgs = {
  activeStatus: string;
  currentSummary: string;
  nextSnapshot: WorkflowSnapshot;
  summaryEntry?: string;
};

type BuildExportSessionStateArgs = {
  activeExports: ExportRecord[];
  record: ExportRecord;
  reportSummary: string;
};

export function buildSummarySessionState({
  currentSummary,
  nextEntry,
  replacePrefix,
}: BuildSummarySessionStateArgs) {
  return mergeSummaryEntries(currentSummary, nextEntry, replacePrefix);
}

export function buildSnapshotSessionState({
  activeStatus,
  currentSummary,
  nextSnapshot,
  summaryEntry,
}: BuildSnapshotSessionStateArgs) {
  const nextSummary = summaryEntry ? mergeSummaryEntries(currentSummary, summaryEntry) : currentSummary;

  const taskUpdate: SessionUpdate = {
    snapshot: nextSnapshot,
    status: deriveTaskStatus(nextSnapshot.phase, activeStatus),
    risks: nextSnapshot.context.risks,
    summary: nextSummary,
  };

  return {
    nextSummary,
    taskUpdate,
  };
}

export function buildExportSessionState({
  activeExports,
  record,
  reportSummary,
}: BuildExportSessionStateArgs) {
  const nextExports = [record, ...activeExports.filter((item) => item.format !== record.format)];

  return {
    exportStatus: record.status,
    taskUpdate: {
      exports: nextExports,
      status: buildExportTaskStatus(record.format),
      summary: reportSummary,
    } satisfies SessionUpdate,
  };
}

export function getComposerValue(request: string) {
  return request === EMPTY_REQUEST ? DEFAULT_REQUEST : request;
}
