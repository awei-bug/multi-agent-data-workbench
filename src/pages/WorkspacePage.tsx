import { useState } from 'react';

import ChartBoard from '../components/charts/ChartBoard';
import DataSourceUploader from '../components/data/DataSourceUploader';
import EditableDataGrid from '../components/data/EditableDataGrid';
import ExportCenter from '../components/export/ExportCenter';
import IntentSummary from '../components/intent/IntentSummary';
import RequirementComposer from '../components/intent/RequirementComposer';
import ReportEditor from '../components/report/ReportEditor';
import ExecutionTimeline from '../components/workflow/ExecutionTimeline';
import WorkflowCanvas from '../components/workflow/WorkflowCanvas';
import { hasLoadedSampleData } from './workspaceSampleData';
import { useWorkspaceSession } from './useWorkspaceSession';

type WorkspacePageProps = {
  onFocusedNodeChange?: (nodeId: string | null) => void;
};

function WorkspacePage({ onFocusedNodeChange }: WorkspacePageProps) {
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const {
    activeTask,
    composerValue,
    exportStatus,
    intentDefaults,
    parsedIntent,
    reportSummary,
    runningNode,
    snapshot,
    handleChartTitleChange,
    handleConfirmCsvMapping,
    handleCreateFromReplay,
    handleExitReplay,
    handleExport,
    handleFail,
    handleImportCsvData,
    handleLoadSampleData,
    handleManualRevision,
    handleParse,
    handlePause,
    handleReportSummaryChange,
    handleRequestDraftChange,
    handleResume,
    handleRetry,
    handleRetryCurrent,
    handleSaveTemplate,
    handleStart,
    handleStop,
  } = useWorkspaceSession();

  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;

  const handleParseWithApi = async (payload: Parameters<typeof handleParse>[0]) => {
    if (!apiBaseUrl || !payload) {
      await handleParse(payload);
      return;
    }

    const response = await fetch(`${apiBaseUrl}/api/intent/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: payload.request }),
    });

    if (!response.ok) {
      throw new Error(`Intent parse failed: ${response.status}`);
    }

    await handleParse(await response.json());
  };

  const handleFocusedNodeChange = (nodeId: string | null) => {
    setFocusedNodeId(nodeId);
    onFocusedNodeChange?.(nodeId);
  };

  return (
    <div className="workspace-grid">
      <DataSourceUploader
        onConfirmCsvMapping={handleConfirmCsvMapping}
        initialLoaded={hasLoadedSampleData(snapshot.context.inputSummary)}
        onImportCsvData={handleImportCsvData}
        onLoadSampleData={handleLoadSampleData}
      />
      <RequirementComposer
        initialValue={composerValue}
        defaultMetrics={intentDefaults.metrics}
        defaultDimensions={intentDefaults.dimensions}
        onDraftChange={handleRequestDraftChange}
        onParse={(payload) => void handleParseWithApi(payload)}
      />
      <IntentSummary summary={parsedIntent} />
      {activeTask.mode === 'replay' ? (
        <section className="content-card workspace-section" aria-label="回放模式操作">
          <div className="section-heading">
            <span className="section-index">03+</span>
            <div>
              <h3>回放模式操作</h3>
              <p>当前工作台正在复用历史任务快照。你可以退出回放，或基于它新建任务。</p>
            </div>
          </div>
          <div className="actions-row">
            <button className="action-button secondary-button" type="button" onClick={handleExitReplay}>
              退出回放
            </button>
            <button className="action-button" type="button" onClick={handleCreateFromReplay}>
              基于回放新建
            </button>
          </div>
        </section>
      ) : null}
      <WorkflowCanvas nodes={snapshot.nodes} onFocusNode={(node) => handleFocusedNodeChange(node?.id ?? null)} />
      <ExecutionTimeline
        runningLabel={runningNode?.label ?? null}
        phase={snapshot.phase}
        logMessage={snapshot.logMessage}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onRetry={handleRetry}
        onFail={handleFail}
        onRetryCurrent={handleRetryCurrent}
        onStop={handleStop}
      />
      <EditableDataGrid onApply={handleManualRevision} />
      <ChartBoard onTitleChange={handleChartTitleChange} />
      <ReportEditor
        summary={reportSummary}
        onSummaryChange={handleReportSummaryChange}
        onExport={handleExport}
        onSaveTemplate={handleSaveTemplate}
      />
      <ExportCenter status={exportStatus} onExport={handleExport} onSaveTemplate={handleSaveTemplate} />
    </div>
  );
}

export default WorkspacePage;
