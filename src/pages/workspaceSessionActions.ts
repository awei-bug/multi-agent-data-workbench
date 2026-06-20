import type { ExportRecord, TaskRecord } from '../types/tasks';
import {
  buildChartTitleSummary,
  buildIntentSummary,
  buildManualRevisionSummary,
  CHART_TITLE_PREFIX,
  MANUAL_REVISION_PREFIX,
} from './workspaceSessionCopy';
import { buildExportSessionState, buildSummarySessionState } from './workspaceSessionController';
import { TASK_STATUS, type SessionUpdate } from './workspaceSessionState';

type ParsedIntent = {
  request: string;
  goal: string;
  metrics: string;
  dimensions: string;
  charts: string;
};

export function buildParseAction(intent: ParsedIntent) {
  const summary = buildIntentSummary(intent.goal);
  const taskUpdate: SessionUpdate = {
    mode: 'live',
    name: intent.goal,
    request: intent.request,
    summary,
    status: TASK_STATUS.idle,
  };

  return {
    parsedIntent: intent,
    summary,
    taskUpdate,
  };
}

export function buildManualRevisionAction(currentSummary: string, value: string) {
  return buildSummarySessionState({
    currentSummary,
    nextEntry: buildManualRevisionSummary(value),
    replacePrefix: MANUAL_REVISION_PREFIX,
  });
}

export function buildChartTitleAction(currentSummary: string, title: string) {
  return buildSummarySessionState({
    currentSummary,
    nextEntry: buildChartTitleSummary(title),
    replacePrefix: CHART_TITLE_PREFIX,
  });
}

export function buildConfirmCsvMappingAction(currentSummary: string, mappingSummary: string) {
  return buildSummarySessionState({
    currentSummary,
    nextEntry: mappingSummary,
    replacePrefix: '字段映射已确认：',
  });
}

export function buildExportAction({
  mode,
  activeExports,
  record,
  reportSummary,
}: {
  mode: TaskRecord['mode'];
  activeExports: ExportRecord[];
  record: ExportRecord;
  reportSummary: string;
}) {
  const nextState = buildExportSessionState({
    activeExports,
    record,
    reportSummary,
  });

  return {
    ...nextState,
    shouldSaveHistory: mode === 'live',
  };
}

export function buildReplayAction() {
  return {
    parsedIntent: null,
  };
}
