import { useEffect, useState } from 'react';

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

type WorkspacePhase = 'input' | 'execution' | 'output';
type InputPane = 'data' | 'intent';
type ExecutionPane = 'monitor' | 'data';
type OutputPane = 'report' | 'export';

function WorkspacePage({ onFocusedNodeChange }: WorkspacePageProps) {
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<WorkspacePhase>('input');
  const [inputPane, setInputPane] = useState<InputPane>('data');
  const [executionPane, setExecutionPane] = useState<ExecutionPane>('monitor');
  const [outputPane, setOutputPane] = useState<OutputPane>('report');
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

  useEffect(() => {
    const focusExport = () => {
      setActivePhase('output');
      setOutputPane('export');
      window.setTimeout(() => {
        document.getElementById('export-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    };
    const loadSample = () => {
      setActivePhase('input');
      setInputPane('data');
      handleLoadSampleData();
    };
    const startTask = () => {
      setActivePhase('execution');
      handleStart();
    };

    window.addEventListener('workspace:focus-export', focusExport);
    window.addEventListener('workspace:load-sample', loadSample);
    window.addEventListener('workspace:start', startTask);

    if (window.location.hash === '#focus-export') {
      focusExport();
    } else if (window.location.hash === '#load-sample') {
      loadSample();
    } else if (window.location.hash === '#start') {
      startTask();
    }

    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }

    return () => {
      window.removeEventListener('workspace:focus-export', focusExport);
      window.removeEventListener('workspace:load-sample', loadSample);
      window.removeEventListener('workspace:start', startTask);
    };
  }, [handleLoadSampleData, handleStart]);

  return (
    <div className="workspace-grid">
      <div className="workspace-phase-tabs" role="tablist" aria-label="工作台阶段">
        <button className={activePhase === 'input' ? 'active' : ''} type="button" onClick={() => setActivePhase('input')}>
          01 输入准备
        </button>
        <button className={activePhase === 'execution' ? 'active' : ''} type="button" onClick={() => setActivePhase('execution')}>
          02 执行编排
        </button>
        <button className={activePhase === 'output' ? 'active' : ''} type="button" onClick={() => setActivePhase('output')}>
          03 报告交付
        </button>
      </div>

      {activePhase === 'input' ? (
        <>
          <section className="workspace-phase-banner workspace-phase-banner-input" aria-label="输入准备阶段">
            <span className="workspace-phase-kicker">阶段一</span>
            <div>
              <h3>输入准备</h3>
              <p>先完成数据接入、需求解析和意图确认，再进入多 Agent 协同执行。</p>
            </div>
          </section>
          <div className="workspace-subtabs" role="tablist" aria-label="输入准备视图">
            <button className={inputPane === 'data' ? 'active' : ''} type="button" onClick={() => setInputPane('data')}>
              数据接入
            </button>
            <button className={inputPane === 'intent' ? 'active' : ''} type="button" onClick={() => setInputPane('intent')}>
              需求确认
            </button>
          </div>
          {inputPane === 'data' ? (
            <DataSourceUploader
              onConfirmCsvMapping={handleConfirmCsvMapping}
              initialLoaded={hasLoadedSampleData(snapshot.context.inputSummary)}
              onImportCsvData={handleImportCsvData}
              onLoadSampleData={handleLoadSampleData}
            />
          ) : (
            <>
              <RequirementComposer
                initialValue={composerValue}
                defaultMetrics={intentDefaults.metrics}
                defaultDimensions={intentDefaults.dimensions}
                onDraftChange={handleRequestDraftChange}
                onParse={(payload) => void handleParseWithApi(payload)}
              />
              <IntentSummary summary={parsedIntent} />
            </>
          )}
        </>
      ) : null}

      {activePhase === 'execution' ? (
        <>
          <section className="workspace-phase-banner workspace-phase-banner-execution" aria-label="执行编排阶段">
            <span className="workspace-phase-kicker">阶段二</span>
            <div>
              <h3>执行编排</h3>
              <p>查看当前节点、运行日志和处理中间结果，必要时在数据表和图表区域即时修订。</p>
            </div>
          </section>
          <div className="workspace-subtabs" role="tablist" aria-label="执行编排视图">
            <button className={executionPane === 'monitor' ? 'active' : ''} type="button" onClick={() => setExecutionPane('monitor')}>
              流程监控
            </button>
            <button className={executionPane === 'data' ? 'active' : ''} type="button" onClick={() => setExecutionPane('data')}>
              数据图表
            </button>
          </div>
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
          {executionPane === 'monitor' ? (
            <>
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
            </>
          ) : (
            <>
              <EditableDataGrid onApply={handleManualRevision} />
              <ChartBoard onTitleChange={handleChartTitleChange} />
            </>
          )}
        </>
      ) : null}

      {activePhase === 'output' ? (
        <>
          <section className="workspace-phase-banner workspace-phase-banner-output" aria-label="报告交付阶段">
            <span className="workspace-phase-kicker">阶段三</span>
            <div>
              <h3>报告交付</h3>
              <p>在报告编辑区沉淀结论，并直接完成导出、模板保存和复用归档。</p>
            </div>
          </section>
          <div className="workspace-subtabs" role="tablist" aria-label="报告交付视图">
            <button className={outputPane === 'report' ? 'active' : ''} type="button" onClick={() => setOutputPane('report')}>
              报告编辑
            </button>
            <button className={outputPane === 'export' ? 'active' : ''} type="button" onClick={() => setOutputPane('export')}>
              导出中心
            </button>
          </div>
          {outputPane === 'report' ? (
            <ReportEditor
              summary={reportSummary}
              onSummaryChange={handleReportSummaryChange}
              onExport={handleExport}
              onSaveTemplate={handleSaveTemplate}
            />
          ) : (
            <ExportCenter status={exportStatus} onExport={handleExport} onSaveTemplate={handleSaveTemplate} />
          )}
        </>
      ) : null}
    </div>
  );
}

export default WorkspacePage;
