import { useMemo, useState } from 'react';

import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { ExportRecord, TaskRecord } from '../types/tasks';
import {
  buildChartTitleAction,
  buildExportAction,
  buildManualRevisionAction,
  buildParseAction,
} from './workspaceSessionActions';
import { DEFAULT_EXPORT_STATUS, DEFAULT_SUMMARY } from './workspaceSessionCopy';
import { getComposerValue } from './workspaceSessionController';
import { createWorkspaceSessionAsyncBridge } from './workspaceSessionAsyncBridge';
import { buildSampleDataContext } from './workspaceSampleData';
import type { ActiveTaskUpdate } from './apiWorkspaceSessionRuntime';

type ParsedIntent = {
  request: string;
  goal: string;
  metrics: string;
  dimensions: string;
  charts: string;
} | null;

type AsyncRuntime = {
  getActiveTask: () => Promise<TaskRecord>;
  updateActiveTask?: (update: ActiveTaskUpdate) => Promise<TaskRecord>;
  resetActiveTask?: () => Promise<TaskRecord>;
  createTaskFromReplay?: () => Promise<TaskRecord>;
  saveActiveTaskToHistory?: () => Promise<TaskRecord>;
  parseIntent?: (request: string) => Promise<Exclude<ParsedIntent, null>>;
};

type UseAsyncWorkspaceSessionOptions = {
  runtime: AsyncRuntime;
};

function toBridgeLabel(status: 'idle' | 'pending' | 'success' | 'error') {
  if (status === 'pending') return '处理中';
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  return '空闲';
}

export function useAsyncWorkspaceSession(options: UseAsyncWorkspaceSessionOptions) {
  const { activeTask, setActiveTask, setContext } = useWorkbenchShell();
  const bridge = useMemo(() => createWorkspaceSessionAsyncBridge(), []);
  const [parsedIntent, setParsedIntent] = useState<ParsedIntent>(null);
  const [composerValue, setComposerValue] = useState(getComposerValue(activeTask.request));
  const [reportSummary, setReportSummary] = useState(activeTask.summary || DEFAULT_SUMMARY);
  const [exportStatus, setExportStatus] = useState(activeTask.exports[0]?.status ?? DEFAULT_EXPORT_STATUS);
  const [bridgeState, setBridgeState] = useState(() => {
    const nextState = bridge.getState();
    return {
      ...nextState,
      status: toBridgeLabel(nextState.status),
    };
  });

  const syncBridgeState = () => {
    const nextState = bridge.getState();
    setBridgeState({
      ...nextState,
      status: toBridgeLabel(nextState.status),
    });
  };

  const syncTaskSession = (task: TaskRecord) => {
    setActiveTask(task);
    setContext(task.snapshot.context);
    setComposerValue(getComposerValue(task.request));
    setReportSummary(task.summary || DEFAULT_SUMMARY);
    setExportStatus(task.exports[0]?.status ?? DEFAULT_EXPORT_STATUS);
  };

  const runTaskAction = async (action: () => Promise<TaskRecord>) => {
    syncBridgeState();

    try {
      const task = await bridge.run(action);
      syncTaskSession(task);
      syncBridgeState();

      return task;
    } catch (error) {
      syncBridgeState();
      throw error;
    }
  };

  const loadActiveTask = async () => runTaskAction(() => options.runtime.getActiveTask());

  const updateActiveTask = async (update: ActiveTaskUpdate) => {
    if (!options.runtime.updateActiveTask) {
      throw new Error('updateActiveTask is not implemented');
    }

    return runTaskAction(() => options.runtime.updateActiveTask!(update));
  };

  const handleReportSummaryChange = async (summary: string) => {
    setReportSummary(summary);

    return updateActiveTask({ summary });
  };

  const handleManualRevision = async (value: string) => {
    const nextSummary = buildManualRevisionAction(reportSummary || DEFAULT_SUMMARY, value);
    setReportSummary(nextSummary);

    return updateActiveTask({ summary: nextSummary });
  };

  const handleChartTitleChange = async (title: string) => {
    const nextSummary = buildChartTitleAction(reportSummary || DEFAULT_SUMMARY, title);
    setReportSummary(nextSummary);

    return updateActiveTask({ summary: nextSummary });
  };

  const handleLoadSampleData = async () => {
    const nextSnapshot = {
      ...activeTask.snapshot,
      context: buildSampleDataContext(activeTask.snapshot.context),
    };

    return updateActiveTask({
      snapshot: nextSnapshot,
      risks: nextSnapshot.context.risks,
    });
  };

  const handleParse = async (nextIntent: Exclude<ParsedIntent, null>) => {
    const resolvedIntent = options.runtime.parseIntent ? await options.runtime.parseIntent(nextIntent.request) : nextIntent;

    setParsedIntent(resolvedIntent);
    setComposerValue(resolvedIntent.request);

    const nextAction = buildParseAction(resolvedIntent);
    setReportSummary(nextAction.summary);

    return updateActiveTask(nextAction.taskUpdate);
  };

  const handleExport = async (record: ExportRecord) => {
    const nextAction = buildExportAction({
      mode: activeTask.mode,
      activeExports: activeTask.exports,
      record,
      reportSummary,
    });

    setExportStatus(nextAction.exportStatus);

    const task = await updateActiveTask(nextAction.taskUpdate);

    if (nextAction.shouldSaveHistory && options.runtime.saveActiveTaskToHistory) {
      return saveActiveTaskToHistory();
    }

    return task;
  };

  const resetActiveTask = async () => {
    if (!options.runtime.resetActiveTask) {
      throw new Error('resetActiveTask is not implemented');
    }

    return runTaskAction(() => options.runtime.resetActiveTask!());
  };

  const createTaskFromReplay = async () => {
    if (!options.runtime.createTaskFromReplay) {
      throw new Error('createTaskFromReplay is not implemented');
    }

    return runTaskAction(() => options.runtime.createTaskFromReplay!());
  };

  const saveActiveTaskToHistory = async () => {
    if (!options.runtime.saveActiveTaskToHistory) {
      throw new Error('saveActiveTaskToHistory is not implemented');
    }

    return runTaskAction(() => options.runtime.saveActiveTaskToHistory!());
  };

  const resetBridge = () => {
    bridge.reset();
    syncBridgeState();
  };

  return {
    activeTask,
    bridge: bridgeState,
    composerValue,
    exportStatus,
    parsedIntent,
    reportSummary,
    handleChartTitleChange,
    handleExport,
    handleLoadSampleData,
    handleManualRevision,
    handleParse,
    handleReportSummaryChange,
    updateActiveTask,
    resetActiveTask,
    createTaskFromReplay,
    saveActiveTaskToHistory,
    loadActiveTask,
    resetBridge,
  };
}
