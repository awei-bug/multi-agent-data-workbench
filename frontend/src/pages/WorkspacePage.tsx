import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import ChartBoard from '../components/charts/ChartBoard';
import EditableDataGrid from '../components/data/EditableDataGrid';
import ExportCenter from '../components/export/ExportCenter';
import IntentSummary from '../components/intent/IntentSummary';
import RequirementComposer from '../components/intent/RequirementComposer';
import ReportEditor from '../components/report/ReportEditor';
import ExecutionTimeline from '../components/workflow/ExecutionTimeline';
import WorkflowCanvas from '../components/workflow/WorkflowCanvas';
import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { ExportRecord, TaskArtifactRecord, TaskRecord } from '../types/tasks';
import { withWorkspaceQuery, workspaceFetch } from '../utils/workspaceIdentity';
import { canAdmin, canWrite } from '../utils/permissions';
import { DEMO_REQUEST, runFullDemoFlow, type DemoProgress } from '../utils/demoFlow';
import DemoProgressBar from '../components/demo/DemoProgressBar';

type Intent = { request: string; goal: string; metrics: string; dimensions: string; charts: string };
export type WorkspaceStage = 'input' | 'execution' | 'output';

const STAGES: Array<{ id: WorkspaceStage; label: string; short: string; code: string; subtitle: string }> = [
  {
    id: 'input',
    label: '输入准备',
    short: '输入',
    code: '01',
    subtitle: '绑定数据源，并把自然语言需求解析成可执行分析意图。',
  },
  {
    id: 'execution',
    label: '执行编排',
    short: '执行',
    code: '02',
    subtitle: '启动多 Agent 链路，查看运行状态、日志与中间产物。',
  },
  {
    id: 'output',
    label: '报告交付',
    short: '交付',
    code: '03',
    subtitle: '审核结果、编辑报告并导出正式交付文件。',
  },
];

function latestArtifact(artifacts: TaskArtifactRecord[] | undefined, type: string) {
  return [...(artifacts ?? [])].reverse().find((item) => item.type === type);
}

function stageFromPhase(phase?: string): WorkspaceStage {
  if (phase === 'running' || phase === 'paused' || phase === 'failed') return 'execution';
  if (phase === 'completed' || phase === 'needs_review' || phase === 'stopped') return 'output';
  return 'input';
}

function normalizeStage(value: string | null | undefined): WorkspaceStage | null {
  if (value === 'input' || value === 'execution' || value === 'output') return value;
  return null;
}

function WorkspacePage() {
  const { activeTask, setActiveTask, setContext } = useWorkbenchShell();
  const navigate = useNavigate();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const [intent, setIntent] = useState<Intent | null>((activeTask as TaskRecord & { intent?: Intent }).intent ?? null);
  const [summary, setSummary] = useState(activeTask.summary);
  const [message, setMessage] = useState('');
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoProgress, setDemoProgress] = useState<DemoProgress | null>(null);

  const stage =
    normalizeStage(searchParams.get('step')) ??
    stageFromPhase(String(activeTask.snapshot?.phase || 'idle'));

  const setStage = (next: WorkspaceStage) => {
    setSearchParams({ step: next }, { replace: true });
  };

  const stageMeta = STAGES.find((item) => item.id === stage) ?? STAGES[0];
  const running = activeTask.snapshot.nodes.find((node) => node.status === 'running');
  const phase = (activeTask.snapshot.phase as string) === 'needs_review' ? 'completed' : activeTask.snapshot.phase;
  const metricArtifact = useMemo(() => latestArtifact(activeTask.artifacts, 'metric_result'), [activeTask.artifacts]);
  const chartArtifact = useMemo(() => latestArtifact(activeTask.artifacts, 'chart_spec'), [activeTask.artifacts]);
  const reportArtifact = useMemo(() => latestArtifact(activeTask.artifacts, 'report_markdown'), [activeTask.artifacts]);
  const cleaningArtifact = useMemo(() => latestArtifact(activeTask.artifacts, 'cleaning_summary'), [activeTask.artifacts]);
  const analysisArtifact = useMemo(() => latestArtifact(activeTask.artifacts, 'analysis'), [activeTask.artifacts]);
  const artifactCount = activeTask.artifacts?.length ?? 0;
  const artifactSummary = activeTask.artifacts?.map((artifact) => artifact.type).join(' / ') || '尚未生成';
  const completedNodes = activeTask.snapshot.nodes.filter((node) => node.status === 'success').length;
  const failedNodes = activeTask.snapshot.nodes.filter((node) => node.status === 'failed').length;
  const totalNodes = activeTask.snapshot.nodes.length || 1;
  const reportMarkdown = String(reportArtifact?.content?.markdown ?? summary);
  const dataSourceScope = activeTask.dataSource
    ? `${activeTask.dataSource.analysisScope?.rowsProcessed ?? activeTask.dataSource.rowCount}/${activeTask.dataSource.analysisScope?.rowCount ?? activeTask.dataSource.rowCount} 行`
    : '未绑定';
  const writeEnabled = canWrite();
  const adminEnabled = canAdmin();

  useEffect(() => {
    // Keep URL step in sync when user lands without query.
    if (!searchParams.get('step')) {
      setSearchParams({ step: stage }, { replace: true });
    }
  }, [searchParams, setSearchParams, stage]);

  useEffect(() => {
    setSummary(activeTask.summary);
    if ((activeTask as TaskRecord & { intent?: Intent }).intent) {
      setIntent((activeTask as TaskRecord & { intent?: Intent }).intent ?? null);
    }
  }, [activeTask.id, activeTask.summary, activeTask.status]);

  const updateTask = (task: TaskRecord) => {
    setActiveTask(task);
    if (task.snapshot?.context) setContext(task.snapshot.context);
    setSummary(task.summary);
  };

  const command = async (path: string, options: RequestInit = {}) => {
    const response = await workspaceFetch(`${apiBaseUrl}${path}`, options);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };

  const parseIntent = async (payload: Intent) => {
    if (!writeEnabled) {
      setMessage('当前角色为只读，无法解析需求。');
      return;
    }
    if (!activeTask.dataSource) {
      setMessage('请先在“数据源”页面选择或上传文件。');
      return;
    }
    try {
      const parsed = (await command('/api/intent/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: payload.request, dataSource: activeTask.dataSource }),
      })) as Intent;
      setIntent(parsed);
      const task = (await command('/api/active-task', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: parsed.goal || payload.request,
          request: payload.request,
          intent: parsed,
          summary: `分析目标：${parsed.goal}\n核心指标：${parsed.metrics}\n分析维度：${parsed.dimensions}`,
        }),
      })) as TaskRecord;
      updateTask(task);
      setMessage('需求已完成结构化解析。可进入“执行”启动任务。');
      setStage('execution');
    } catch {
      setMessage('需求解析失败，请检查后端服务状态。');
    }
  };

  const workflow = async (action: string) => {
    try {
      setMessage(action === 'start' ? '正在提交异步工作流任务...' : '正在更新执行状态...');
      const task = (await command('/api/workflow/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })) as TaskRecord & { execution?: { status?: string; jobId?: string; mode?: string } };
      updateTask(task);

      const terminalPhases = ['completed', 'needs_review', 'failed', 'stopped', 'paused'];
      const jobStatus = task.execution?.status;
      const isAsyncRunning =
        task.execution?.mode === 'async' &&
        (jobStatus === 'queued' || jobStatus === 'running' || task.snapshot?.phase === 'running') &&
        !terminalPhases.includes(String(task.snapshot?.phase));

      if (isAsyncRunning && ['start', 'resume', 'retry', 'retry_current'].includes(action)) {
        setMessage('异步任务已入队，正在后台推进节点...');
        const startedAt = Date.now();
        while (Date.now() - startedAt < 60000) {
          await new Promise((resolve) => window.setTimeout(resolve, 700));
          const polled = (await command('/api/tasks/active')) as TaskRecord & {
            execution?: { status?: string; lastError?: string; mode?: string };
          };
          updateTask(polled);
          const nextPhase = String(polled.snapshot?.phase);
          const status = polled.execution?.status;
          if (terminalPhases.includes(nextPhase) || status === 'succeeded' || status === 'failed' || status === 'cancelled') {
            if (status === 'failed') {
              setMessage(`异步任务失败：${polled.execution?.lastError || polled.status}`);
            } else if (status === 'cancelled' || nextPhase === 'stopped') {
              setMessage('异步任务已终止。');
            } else {
              setMessage(`流程已结束：${polled.status}`);
              setStage('output');
            }
            return;
          }
        }
        setMessage('异步任务仍在执行，可稍后刷新查看最新进度。');
        return;
      }

      const done = terminalPhases.includes(String(task.snapshot?.phase));
      setMessage(done ? `流程已结束：${task.status}` : '流程状态已更新。');
      if (done && !['failed', 'stopped', 'paused'].includes(String(task.snapshot?.phase))) {
        setStage('output');
      }
    } catch {
      setMessage('工作流命令执行失败。');
    }
  };

  const saveSummary = async (value: string) => {
    setSummary(value);
    const task = (await command('/api/active-task', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: value }),
    })) as TaskRecord;
    updateTask(task);
  };

  const correct = async (value: string) => {
    const task = (await command('/api/tasks/active/correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: `${summary}\n\n人工修正：${value}` }),
    })) as TaskRecord;
    updateTask(task);
    setMessage('已记录人工修正，下游节点需要重新执行。');
  };

  const exportReport = async (record: ExportRecord) => {
    try {
      const artifact = (await command('/api/tasks/active/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: record.format, report: summary }),
      })) as { downloadUrl: string; fileName: string };
      window.location.assign(withWorkspaceQuery(`${apiBaseUrl}${artifact.downloadUrl}`));
      setMessage(`已生成导出文件：${artifact.fileName}`);
    } catch {
      setMessage('导出前请先完成审核节点。');
    }
  };

  const saveTemplate = async () => {
    await command('/api/templates/save-active-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: activeTask.name, request: activeTask.request, summary }),
    });
    setMessage('当前任务已保存为模板。');
  };

  const startDemo = async () => {
    if (!writeEnabled || demoLoading) return;
    setDemoLoading(true);
    setMessage('正在启动完整示例演示…');
    try {
      const result = await runFullDemoFlow({
        apiBaseUrl,
        currentTask: activeTask,
        autoStart: true,
        onProgress: (progress) => {
          setDemoProgress(progress);
          setMessage(progress.detail || progress.label);
        },
        onTask: (task) => updateTask(task),
      });
      setIntent(result.intent);
      if (result.reachedDelivery) {
        setMessage('示例演示完成，已进入报告交付。');
        setStage('output');
      } else if (String(result.task.snapshot.phase) === 'failed') {
        setMessage('示例执行失败，请在执行页重试。');
        setStage('execution');
      } else {
        setMessage('示例已启动，正在执行中。');
        setStage('execution');
      }
    } catch {
      setDemoProgress({ stage: 'error', percent: 100, label: '演示失败', detail: '请稍后重试。' });
      setMessage('示例演示启动失败，请稍后重试。');
    } finally {
      setDemoLoading(false);
    }
  };

  const stageIndex = STAGES.findIndex((item) => item.id === stage);
  const hasDataSource = Boolean(activeTask.dataSource);
  const hasIntent = Boolean(intent || activeTask.request);
  const isRunning = String(activeTask.snapshot.phase) === 'running' || activeTask.execution?.status === 'running' || activeTask.execution?.status === 'queued';
  const isFailed = String(activeTask.snapshot.phase) === 'failed' || activeTask.execution?.status === 'failed';
  const isCompleted = ['completed', 'needs_review'].includes(String(activeTask.snapshot.phase));

  const actionCard = (() => {
    if (stage === 'input') {
      if (!hasDataSource) {
        return {
          title: '下一步：接入数据源',
          desc: '当前还没有可分析数据。可上传文件，或一键载入示例数据开始演示。',
          primaryLabel: demoLoading ? '准备示例中…' : '一键示例演示',
          primaryAction: () => {
            if (writeEnabled) void startDemo();
          },
          secondaryLabel: '去接入数据源',
          secondaryAction: () => navigate('/data-sources'),
          tips: ['示例数据含 12 个月销售明细', '将自动解析需求并启动到交付'],
          tone: 'warn' as const,
          primaryDisabled: !writeEnabled || demoLoading,
        };
      }
      if (!hasIntent) {
        return {
          title: '下一步：解析分析需求',
          desc: '数据源已绑定。请填写业务问题并点击解析，系统会生成目标、指标和维度。',
          primaryLabel: '查看需求输入区',
          primaryAction: () => {
            document.getElementById('requirement-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
          secondaryLabel: '跳到执行步骤',
          secondaryAction: () => setStage('execution'),
          tips: ['写清楚时间范围、维度、关注指标', '解析后可自动进入执行步骤'],
          tone: 'info' as const,
        };
      }
      return {
        title: '下一步：进入执行编排',
        desc: '需求已准备完成。进入执行步骤启动多 Agent 工作流。',
        primaryLabel: '进入执行',
        primaryAction: () => setStage('execution'),
        secondaryLabel: '继续修改需求',
        secondaryAction: () => {
          document.getElementById('requirement-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
        tips: ['执行过程支持暂停 / 重试 / 终止', '完成后会自动进入交付步骤'],
        tone: 'success' as const,
      };
    }

    if (stage === 'execution') {
      if (!hasDataSource) {
        return {
          title: '缺少数据源',
          desc: '执行前必须绑定数据源。',
          primaryLabel: '去接入数据源',
          primaryAction: () => navigate('/data-sources'),
          secondaryLabel: '返回输入',
          secondaryAction: () => setStage('input'),
          tips: ['先绑定数据，再启动任务'],
          tone: 'warn' as const,
        };
      }
      if (isRunning) {
        return {
          title: '任务执行中',
          desc: running ? `当前节点：${running.label}` : '后台正在推进多 Agent 节点。',
          primaryLabel: '查看执行面板',
          primaryAction: () => {
            document.getElementById('execution-timeline')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
          secondaryLabel: '暂停任务',
          secondaryAction: () => void workflow('pause'),
          tips: ['可在下方查看节点状态与日志', '完成后会提示进入交付'],
          tone: 'info' as const,
        };
      }
      if (isFailed) {
        return {
          title: '下一步：处理失败节点',
          desc: '流程出现异常，建议先重试当前节点或全流程。',
          primaryLabel: '重试当前节点',
          primaryAction: () => void workflow('retry_current'),
          secondaryLabel: '重试全流程',
          secondaryAction: () => void workflow('retry'),
          tips: ['也可返回输入修正需求后再启动'],
          tone: 'danger' as const,
        };
      }
      if (isCompleted) {
        return {
          title: '下一步：进入报告交付',
          desc: '流程已完成，可以审核结果并导出报告。',
          primaryLabel: '进入交付',
          primaryAction: () => setStage('output'),
          secondaryLabel: '重新执行',
          secondaryAction: () => void workflow('retry'),
          tips: ['交付页支持 Markdown / Word / PDF 导出'],
          tone: 'success' as const,
        };
      }
      return {
        title: '下一步：启动分析任务',
        desc: '数据与需求已就绪，点击启动后多 Agent 将异步推进。',
        primaryLabel: writeEnabled ? '启动任务' : '只读角色不可启动',
        primaryAction: () => {
          if (writeEnabled) void workflow('start');
        },
        secondaryLabel: '返回输入检查',
        secondaryAction: () => setStage('input'),
        tips: ['启动后可在本页实时查看进度', '失败可单节点重试'],
        tone: 'success' as const,
        primaryDisabled: !writeEnabled,
      };
    }

    // output
    if (!isCompleted && !reportArtifact) {
      return {
        title: '下一步：先完成执行',
        desc: '当前还没有可交付报告，建议返回执行步骤完成分析。',
        primaryLabel: '返回执行',
        primaryAction: () => setStage('execution'),
        secondaryLabel: '查看历史任务',
        secondaryAction: () => navigate('/history'),
        tips: ['执行完成后会自动生成报告草稿'],
        tone: 'warn' as const,
      };
    }
    return {
      title: '下一步：导出交付物',
      desc: '报告已可精修。确认摘要后导出 PDF / Word / Markdown。',
      primaryLabel: '滚动到导出中心',
      primaryAction: () => {
        document.getElementById('export-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      secondaryLabel: '打开报告中心',
      secondaryAction: () => navigate('/reports'),
      tips: ['管理员可保存为模板复用', '导出前建议先校对摘要'],
      tone: 'success' as const,
    };
  })();

  return (
    <div className="workspace-grid workspace-stage-grid workspace-stage-grid-enterprise workspace-wizard">
      <section className={`workspace-command-header workspace-phase-banner-${stage}`}>
        <div className="workspace-command-copy">
          <span className="workspace-breadcrumb">分析工作台 / 三步向导</span>
          <div className="workspace-command-title-row">
            <div>
              <span className="workspace-command-kicker">{stageMeta.code}</span>
              <h2>{activeTask.name || '多 Agent 协同分析工作台'}</h2>
              <p>{stageMeta.subtitle}</p>
            </div>
            <div className="workspace-command-actions">
              <button
                className="action-button secondary-button"
                type="button"
                disabled={!writeEnabled || demoLoading}
                onClick={() => void startDemo()}
              >
                {demoLoading ? '准备示例中…' : '一键示例演示'}
              </button>
              <Link className="action-button secondary-button" to="/data-sources">
                管理数据源
              </Link>
              {stage !== 'output' ? (
                <button
                  className="action-button"
                  type="button"
                  onClick={() => setStage(stage === 'input' ? 'execution' : 'output')}
                >
                  {stage === 'input' ? '下一步：执行' : '下一步：交付'}
                </button>
              ) : (
                <Link className="action-button" to="/reports">
                  打开报告中心
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="workspace-wizard-steps" aria-label="分析工作台步骤">
          {STAGES.map((item, index) => {
            const active = item.id === stage;
            const done = index < stageIndex;
            return (
              <button
                key={item.id}
                type="button"
                className={`workspace-wizard-step${active ? ' active' : ''}${done ? ' done' : ''}`}
                onClick={() => setStage(item.id)}
              >
                <span>{item.code}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.subtitle}</small>
                </div>
              </button>
            );
          })}
        </div>

        <div className="workspace-overview-strip">
          <article className="workspace-overview-card workspace-overview-card-primary">
            <span>当前步骤</span>
            <strong>{stageMeta.label}</strong>
            <small>{activeTask.status}</small>
          </article>
          <article className="workspace-overview-card">
            <span>任务进度</span>
            <strong>{`${completedNodes}/${totalNodes}`}</strong>
            <small>{running ? `当前：${running.label}` : '等待启动或已完成'}</small>
          </article>
          <article className="workspace-overview-card">
            <span>数据范围</span>
            <strong>{activeTask.dataSource?.fileName ?? '未绑定数据源'}</strong>
            <small>{dataSourceScope}</small>
          </article>
          <article className="workspace-overview-card">
            <span>产物与风险</span>
            <strong>{`${artifactCount} 个产物`}</strong>
            <small>{failedNodes > 0 ? `${failedNodes} 个异常节点` : `${activeTask.risks.length} 条待关注事项`}</small>
          </article>
        </div>
      </section>

      <DemoProgressBar progress={demoProgress} />

      <div className="workspace-main-layout">
        <div className="workspace-main-content">
      {stage === 'input' ? (
        <>
          <section className="workspace-focus-band">
            <article className="workspace-focus-card">
              <span>本阶段目标</span>
              <strong>把业务问题转成结构化分析意图</strong>
              <p>先确认数据源，再补齐目标、指标、维度与图表诉求。</p>
            </article>
            <article className="workspace-focus-card">
              <span>当前状态</span>
              <strong>{activeTask.dataSource ? '可开始需求解析' : '等待绑定数据源'}</strong>
              <p>{activeTask.dataSource ? `已接入 ${activeTask.dataSource.fileName}` : '先到数据源页面上传或绑定文件。'}</p>
            </article>
          </section>

          <RequirementComposer
            initialValue={activeTask.request}
            onParse={(payload) => void parseIntent(payload)}
            readOnly={!writeEnabled}
          />
          <IntentSummary summary={intent} />

          {activeTask.dataSource?.kind === 'document' ? (
            <section className="content-card workspace-section">
              <div className="section-heading">
                <span className="section-index">DOC</span>
                <div>
                  <h3>文档分析模式</h3>
                  <p>当前文件将按文本理解方式分析，重点提取主题、证据和结论，而不是做表格汇总。</p>
                </div>
              </div>
              <div className="summary-grid summary-grid-strong">
                <div className="summary-card">
                  <span>字符数</span>
                  <strong>{activeTask.dataSource.profile?.charCount ?? 0}</strong>
                </div>
                <div className="summary-card">
                  <span>段落数</span>
                  <strong>{activeTask.dataSource.profile?.paragraphCount ?? activeTask.dataSource.rowCount}</strong>
                </div>
                <div className="summary-card">
                  <span>关键词</span>
                  <strong>{activeTask.dataSource.profile?.keywords?.length ?? 0}</strong>
                </div>
                <div className="summary-card">
                  <span>分析方式</span>
                  <strong>文本洞察</strong>
                </div>
              </div>
            </section>
          ) : null}

          <section className="content-card workspace-section">
            <div className="section-heading">
              <span className="section-index">DS</span>
              <div>
                <h3>当前数据源</h3>
                <p>这里只显示本次分析会实际消费的数据范围，数据接入与切换在独立页面完成。</p>
              </div>
            </div>
            {!activeTask.dataSource ? (
              <p className="status-note">尚未绑定数据源。请先前往“数据源中心”选择或上传文件。</p>
            ) : (
              <div className="workspace-source-summary">
                <strong>{activeTask.dataSource.fileName}</strong>
                <p>{`实际分析范围：${dataSourceScope}`}</p>
              </div>
            )}
            <div className="actions-row">
              <Link className="action-button secondary-button" to="/data-sources">
                打开数据源中心
              </Link>
              <button className="action-button" type="button" onClick={() => setStage('execution')}>
                下一步：执行编排
              </button>
            </div>
            {message ? <p className="status-note">{message}</p> : null}
          </section>
        </>
      ) : null}

      {stage === 'execution' ? (
        <>
          <section className="workspace-focus-band">
            <article className="workspace-focus-card workspace-focus-card-live">
              <span>运行态势</span>
              <strong>{running ? `正在执行：${running.label}` : '等待启动或已完成'}</strong>
              <p>{activeTask.snapshot.logMessage}</p>
            </article>
            <article className="workspace-focus-card">
              <span>中间产物</span>
              <strong>{artifactCount > 0 ? `${artifactCount} 项已生成` : '尚无产物'}</strong>
              <p>{`当前产物：${artifactSummary}`}</p>
            </article>
          </section>

          <WorkflowCanvas nodes={activeTask.snapshot.nodes} />
          <ExecutionTimeline
            runningLabel={running?.label ?? null}
            phase={phase as 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'}
            logMessage={activeTask.snapshot.logMessage}
            onStart={() => void workflow('start')}
            onPause={() => void workflow('pause')}
            onResume={() => void workflow('resume')}
            onRetry={() => void workflow('retry')}
            onFail={() => void workflow('fail')}
            onRetryCurrent={() => void workflow('retry_current')}
            onStop={() => void workflow('stop')}
            readOnly={!writeEnabled}
          />

          {cleaningArtifact ? (
            <section className="content-card workspace-section">
              <div className="section-heading">
                <span className="section-index">CL</span>
                <div>
                  <h3>清洗结果</h3>
                  <p>服务端在数据治理阶段识别出的处理动作与修正规则。</p>
                </div>
              </div>
              <ul className="context-risk-list">
                {(Array.isArray(cleaningArtifact.content?.changes)
                  ? (cleaningArtifact.content?.changes as string[])
                  : []
                ).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <EditableDataGrid onApply={(value) => void correct(value)} />
          <ChartBoard
            dataSource={activeTask.dataSource}
            metricArtifact={metricArtifact}
            chartArtifact={chartArtifact}
            onTitleChange={() => undefined}
          />

          {activeTask.dataSource?.kind === 'document' ? (
            <section className="content-card workspace-section">
              <div className="section-heading">
                <span className="section-index">EV</span>
                <div>
                  <h3>关键证据</h3>
                  <p>展示文档分析链路提取出的支撑段落，方便人工审核与复核。</p>
                </div>
              </div>
              <ol className="context-risk-list">
                {(
                  (
                    (analysisArtifact?.content?.evidence as { evidence?: Array<{ text: string }> } | undefined)
                      ?.evidence ?? []
                  ).map((item, index) => (
                    <li key={`${index}-${item.text}`}>{item.text}</li>
                  ))
                )}
              </ol>
            </section>
          ) : null}

          <div className="actions-row">
            <button className="action-button secondary-button" type="button" onClick={() => setStage('input')}>
              返回输入
            </button>
            <button className="action-button" type="button" onClick={() => setStage('output')}>
              下一步：报告交付
            </button>
          </div>
          {message ? <p className="status-note">{message}</p> : null}
        </>
      ) : null}

      {stage === 'output' ? (
        <>
          <section className="workspace-focus-band">
            <article className="workspace-focus-card workspace-focus-card-success">
              <span>交付状态</span>
              <strong>{reportArtifact ? '报告已生成，可继续精修' : '等待生成最终报告'}</strong>
              <p>支持在当前页编辑摘要、沉淀模板并导出正式文件。</p>
            </article>
            <article className="workspace-focus-card">
              <span>可导出内容</span>
              <strong>{activeTask.exports.length > 0 ? `${activeTask.exports.length} 个导出记录` : '尚未导出'}</strong>
              <p>建议在审核完成后导出 PDF、Word 或 Markdown。</p>
            </article>
          </section>

          <ReportEditor
            summary={reportMarkdown}
            onSummaryChange={(value) => void saveSummary(value)}
            onExport={(record) => void exportReport(record)}
            onSaveTemplate={() => void saveTemplate()}
          />
          <ExportCenter
            status={message || '等待审核完成后再导出'}
            onExport={(record) => void exportReport(record)}
            onSaveTemplate={() => void saveTemplate()}
            readOnly={!writeEnabled}
            canManageTemplates={adminEnabled}
          />
          <div className="actions-row">
            <button className="action-button secondary-button" type="button" onClick={() => setStage('execution')}>
              返回执行
            </button>
            <Link className="action-button secondary-button" to="/reports">
              打开报告中心
            </Link>
            <Link className="action-button secondary-button" to="/history">
              查看历史任务
            </Link>
          </div>
        </>
      ) : null}
        </div>

        <aside className={`workspace-action-rail tone-${actionCard.tone}`} aria-label="下一步行动">
          <div className="workspace-action-rail-head">
            <span>下一步行动</span>
            <strong>{actionCard.title}</strong>
            <p>{actionCard.desc}</p>
          </div>
          <div className="workspace-action-rail-actions">
            <button
              className="action-button"
              type="button"
              disabled={'primaryDisabled' in actionCard ? Boolean(actionCard.primaryDisabled) : false}
              onClick={actionCard.primaryAction}
            >
              {actionCard.primaryLabel}
            </button>
            <button className="action-button secondary-button" type="button" onClick={actionCard.secondaryAction}>
              {actionCard.secondaryLabel}
            </button>
          </div>
          <ul className="workspace-action-rail-tips">
            {actionCard.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
          {message ? <p className="status-note workspace-action-rail-status">{message}</p> : null}
          <div className="workspace-action-rail-meta">
            <span>当前步骤</span>
            <strong>{stageMeta.label}</strong>
            <span>任务状态</span>
            <strong>{activeTask.status}</strong>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default WorkspacePage;
