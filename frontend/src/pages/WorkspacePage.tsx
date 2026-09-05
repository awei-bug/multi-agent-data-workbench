import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import ChartBoard from '../components/charts/LazyChartBoard';
import EditableDataGrid from '../components/data/EditableDataGrid';
import ExportCenter from '../components/export/ExportCenter';
import FlowAlert from '../components/feedback/FlowAlert';
import { useOptionalToast } from '../components/feedback/ToastContext';
import IntentSummary from '../components/intent/IntentSummary';
import RequirementComposer from '../components/intent/RequirementComposer';
import ReportEditor from '../components/report/ReportEditor';
import ExecutionTimeline from '../components/workflow/ExecutionTimeline';
import WorkflowCanvas from '../components/workflow/WorkflowCanvas';
import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { ExportRecord, TaskArtifactRecord, TaskRecord } from '../types/tasks';
import { isDemoFlowEnabled, withTicketQuery, workspaceFetch } from '../utils/workspaceIdentity';
import { canAdmin, canWrite } from '../utils/permissions';
import { DEMO_REQUEST, runFullDemoFlow, type DemoProgress } from '../utils/demoFlow';
import DemoProgressBar from '../components/demo/DemoProgressBar';
import {
  evaluateStageAccess,
  getStageReadiness,
  type WorkspaceStage as GateStage,
} from '../utils/workspaceStageGate';

type Intent = { request: string; goal: string; metrics: string; dimensions: string; charts: string };
export type WorkspaceStage = GateStage;

const STAGES: Array<{ id: WorkspaceStage; label: string; short: string; code: string; subtitle: string }> = [
  {
    id: 'input',
    label: '说明问题',
    short: '问题',
    code: '01',
    subtitle: '确认数据，并用一句话说明你想分析什么。',
  },
  {
    id: 'execution',
    label: '开始分析',
    short: '分析',
    code: '02',
    subtitle: '点一次开始，系统自动处理并生成图表。',
  },
  {
    id: 'output',
    label: '查看结果',
    short: '结果',
    code: '03',
    subtitle: '阅读结论，需要时导出报告。',
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
  const toastApi = useOptionalToast();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const [intent, setIntent] = useState<Intent | null>((activeTask as TaskRecord & { intent?: Intent }).intent ?? null);
  const [summary, setSummary] = useState(activeTask.summary);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'warn' | 'danger'>('info');
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoProgress, setDemoProgress] = useState<DemoProgress | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [showPlanDetails, setShowPlanDetails] = useState(false);
  const [showExpertView, setShowExpertView] = useState(false);

  const notify = (
    title: string,
    options?: { description?: string; tone?: 'info' | 'success' | 'warn' | 'danger'; keepMessage?: boolean },
  ) => {
    const tone = options?.tone ?? 'info';
    if (options?.keepMessage !== false) {
      setMessage(options?.description ? `${title} ${options.description}` : title);
      setMessageTone(tone);
    }
    toastApi?.pushToast({ title, description: options?.description, tone });
  };

  const requestedStage =
    normalizeStage(searchParams.get('step')) ??
    stageFromPhase(String(activeTask.snapshot?.phase || 'idle'));
  const stageGate = evaluateStageAccess(requestedStage, activeTask, intent);
  const stage = stageGate.allowed ? requestedStage : stageGate.redirectTo;

  const setStage = (next: WorkspaceStage, options?: { force?: boolean }) => {
    if (!options?.force) {
      const gate = evaluateStageAccess(next, activeTask, intent);
      if (!gate.allowed) {
        notify(gate.reason, {
          tone: 'warn',
          description: gate.ctaLabel ? `建议：${gate.ctaLabel}` : undefined,
        });
        setSearchParams({ step: gate.redirectTo }, { replace: true });
        return false;
      }
    }
    setSearchParams({ step: next }, { replace: true });
    return true;
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
  const artifactSummary = artifactCount > 0 ? `${artifactCount} 项分析内容` : '还没有生成内容';
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
    // Keep URL step in sync, and snap blocked stages back to the allowed step.
    const current = searchParams.get('step');
    if (!current || current !== stage) {
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
    // Merge instead of replace: SSE/partial payloads must not wipe dataSource/artifacts.
    setActiveTask((current) => {
      const next = {
        ...current,
        ...task,
        snapshot: task.snapshot ?? current.snapshot,
        execution: task.execution ? { ...(current.execution || {}), ...task.execution } : current.execution,
        dataSource: task.dataSource ?? current.dataSource,
        artifacts: task.artifacts ?? current.artifacts,
        exports: task.exports ?? current.exports,
        risks: task.risks ?? current.risks,
        executionLog: task.executionLog ?? current.executionLog,
        intent: task.intent ?? current.intent,
        summary: task.summary ?? current.summary,
        request: task.request ?? current.request,
        status: task.status ?? current.status,
        name: task.name ?? current.name,
      };
      if (next.snapshot?.context) setContext(next.snapshot.context);
      setSummary(next.summary);
      return next;
    });
  };

  const command = async (path: string, options: RequestInit = {}) => {
    const response = await workspaceFetch(`${apiBaseUrl}${path}`, options);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };

  const parseIntent = async (payload: Intent) => {
    if (!writeEnabled) {
      notify('当前角色为只读，无法解析需求。', { tone: 'warn' });
      return;
    }
    if (!activeTask.dataSource) {
      notify('请先绑定数据源', { description: '前往数据源页面上传或选择文件。', tone: 'warn' });
      return;
    }
    if (!payload.request.trim()) {
      notify('请先填写分析需求', { tone: 'warn' });
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
      notify('分析方案已生成', { description: '可以进入下一步开始分析了。', tone: 'success' });
      setStage('execution', { force: true });
    } catch {
      notify('生成分析方案失败', { description: '请检查网络或后端服务后重试。', tone: 'danger' });
    }
  };

  const workflow = async (action: string) => {
    if (!writeEnabled) {
      notify('当前角色为只读，无法控制工作流。', { tone: 'warn' });
      return;
    }
    if (['start', 'resume', 'retry', 'retry_current'].includes(action)) {
      if (!activeTask.dataSource) {
        notify('还没有数据', { description: '请先上传数据，再开始分析。', tone: 'warn' });
        setStage('input', { force: true });
        return;
      }
      if (!getStageReadiness(activeTask, intent).hasIntent && action === 'start') {
        notify('请先写清楚问题', { description: '生成分析方案后，才能开始分析。', tone: 'warn' });
        setStage('input', { force: true });
        return;
      }
    }
    try {
      setWorkflowBusy(true);
      notify(action === 'start' ? '正在提交分析任务…' : '正在更新执行状态…', { tone: 'info' });
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
        notify('异步任务已入队，正在实时同步进度...', { tone: 'info' });
        const streamUrl = await withTicketQuery(
          `${apiBaseUrl}/api/workflow/jobs/stream`,
          apiBaseUrl,
          'stream',
        );

        const finishedViaSse = await new Promise<boolean>((resolve) => {
          let settled = false;
          let source: EventSource | null = null;
          const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            try {
              source?.close();
            } catch {
              // ignore
            }
            resolve(value);
          };

          try {
            source = new EventSource(streamUrl);
          } catch {
            finish(false);
            return;
          }

          const onPayload = (raw: string) => {
            try {
              const payload = JSON.parse(raw) as {
                task?: TaskRecord & { execution?: { status?: string; lastError?: string } };
              };
              if (!payload.task) return;
              updateTask(payload.task);
              const nextPhase = String(payload.task.snapshot?.phase || '');
              const status = payload.task.execution?.status;
              if (
                terminalPhases.includes(nextPhase) ||
                status === 'succeeded' ||
                status === 'failed' ||
                status === 'cancelled'
              ) {
                if (status === 'failed') {
                  notify(`异步任务失败：${payload.task.execution?.lastError || payload.task.status}`, { tone: 'danger' });
                } else if (status === 'cancelled' || nextPhase === 'stopped') {
                  notify('异步任务已终止。', { tone: 'warn' });
                } else {
                  notify(`流程已结束：${payload.task.status}`, { tone: 'info' });
                  setStage('output', { force: true });
                }
                finish(true);
              }
            } catch {
              // ignore malformed chunks
            }
          };

          source.addEventListener('workflow', (event) => {
            onPayload((event as MessageEvent).data);
          });
          source.addEventListener('done', (event) => {
            onPayload((event as MessageEvent).data);
            finish(true);
          });
          source.onerror = () => finish(false);
          window.setTimeout(() => finish(false), 60000);
        });

        if (finishedViaSse) {
          // Always re-fetch full task once SSE ends to guarantee artifacts/dataSource are present.
          try {
            const finalTask = (await command('/api/tasks/active')) as TaskRecord & {
              execution?: { status?: string; lastError?: string };
            };
            updateTask(finalTask);
            const nextPhase = String(finalTask.snapshot?.phase || '');
            const status = finalTask.execution?.status;
            if (status === 'failed') {
              notify(`异步任务失败：${finalTask.execution?.lastError || finalTask.status}`, { tone: 'danger' });
            } else if (status === 'cancelled' || nextPhase === 'stopped') {
              notify('异步任务已终止。', { tone: 'warn' });
            } else if (terminalPhases.includes(nextPhase) || status === 'succeeded') {
              notify(`流程已结束：${finalTask.status}`, { tone: 'info' });
              if (!['failed', 'stopped', 'paused'].includes(nextPhase)) {
                setStage('output', { force: true });
              }
            }
          } catch {
            // ignore
          }
          return;
        }

        // Fallback to polling if SSE is unavailable.
        notify('实时通道不可用，改用轮询同步进度...', { tone: 'info' });
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
              notify(`异步任务失败：${polled.execution?.lastError || polled.status}`, { tone: 'danger' });
            } else if (status === 'cancelled' || nextPhase === 'stopped') {
              notify('异步任务已终止。', { tone: 'warn' });
            } else {
              notify(`流程已结束：${polled.status}`, { tone: 'info' });
              setStage('output', { force: true });
            }
            return;
          }
        }
        notify('异步任务仍在执行，可稍后刷新查看最新进度。', { tone: 'info' });
        return;
      }

      // Final full refresh after sync/async path settles.
      try {
        const latest = (await command('/api/tasks/active')) as TaskRecord;
        updateTask(latest);
      } catch {
        // ignore
      }

      const done = terminalPhases.includes(String(task.snapshot?.phase));
      notify(done ? `流程已结束：${task.status}` : '流程状态已更新。', { tone: 'info' });
      if (done && !['failed', 'stopped', 'paused'].includes(String(task.snapshot?.phase))) {
        setStage('output', { force: true });
      }
    } catch {
      notify('流程操作失败', { description: '请稍后重试。', tone: 'danger' });
    } finally {
      setWorkflowBusy(false);
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
    notify('已记录人工修正，下游节点需要重新执行。', { tone: 'info' });
  };

  const exportReport = async (record: ExportRecord) => {
    try {
      const artifact = (await command('/api/tasks/active/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: record.format, report: summary }),
      })) as { downloadUrl: string; fileName: string };
      const url = await withTicketQuery(`${apiBaseUrl}${artifact.downloadUrl}`, apiBaseUrl, 'download');
      window.location.assign(url);
      notify(`已生成导出文件：${artifact.fileName}`, { tone: 'success' });
    } catch {
      notify('导出前请先完成审核节点。', { tone: 'success' });
    }
  };

  const saveTemplate = async () => {
    await command('/api/templates/save-active-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: activeTask.name, request: activeTask.request, summary }),
    });
    notify('当前任务已保存为模板。', { tone: 'success' });
  };

  const startDemo = async () => {
    if (!writeEnabled || demoLoading) return;
    if (!isDemoFlowEnabled()) {
      notify('生产环境已关闭示例演示，请使用真实数据走主流程。', { tone: 'warn' });
      return;
    }
    setDemoLoading(true);
    notify('正在启动完整示例演示…', { tone: 'info' });
    try {
      const result = await runFullDemoFlow({
        apiBaseUrl,
        currentTask: activeTask,
        autoStart: true,
        onProgress: (progress) => {
          setDemoProgress(progress);
          notify(progress.detail || progress.label, { tone: 'info' });
        },
        onTask: (task) => updateTask(task),
      });
      setIntent(result.intent);
      if (result.reachedDelivery) {
        notify('示例演示完成，已进入查看结果。', { tone: 'success' });
        setStage('output', { force: true });
      } else if (String(result.task.snapshot.phase) === 'failed') {
        notify('示例执行失败，请在执行页重试。', { tone: 'danger' });
        setStage('execution');
      } else {
        notify('示例已启动，正在执行中。', { tone: 'info' });
        setStage('execution');
      }
    } catch {
      setDemoProgress({ stage: 'error', percent: 100, label: '演示失败', detail: '请稍后重试。' });
      notify('示例演示启动失败，请稍后重试。', { tone: 'danger' });
    } finally {
      setDemoLoading(false);
    }
  };

  const stageIndex = STAGES.findIndex((item) => item.id === stage);
  const readiness = getStageReadiness(activeTask, intent);
  const hasDataSource = readiness.hasDataSource;
  const hasIntent = readiness.hasIntent;
  const isRunning = readiness.isRunning;
  const isFailed = readiness.isFailed;
  const isCompleted = readiness.isCompleted;
  const executionGate = evaluateStageAccess('execution', activeTask, intent);
  const outputGate = evaluateStageAccess('output', activeTask, intent);

  const actionCard = (() => {
    if (stage === 'input') {
      if (!hasDataSource) {
        return {
          title: '下一步：上传数据',
          desc: '当前还没有可分析数据。可上传文件，或一键载入示例数据开始演示。',
          primaryLabel: demoLoading ? '准备示例中…' : '看示例',
          primaryAction: () => {
            if (writeEnabled) void startDemo();
          },
          secondaryLabel: '去上传数据',
          secondaryAction: () => navigate('/data-sources'),
          tips: ['示例数据含 12 个月销售明细', '将自动填写问题并开始分析'],
          tone: 'warn' as const,
          primaryDisabled: !writeEnabled || demoLoading,
        };
      }
      if (!hasIntent) {
        return {
          title: '下一步：说明你的问题',
          desc: '数据已经准备好。用一句话写下你想分析什么，再点“生成分析方案”。',
          primaryLabel: '去填写问题',
          primaryAction: () => {
            document.getElementById('requirement-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
          secondaryLabel: '去上传数据',
          secondaryAction: () => navigate('/data-sources'),
          tips: ['写清楚时间范围、对比对象、关注指标', '生成方案后就能开始分析'],
          tone: 'info' as const,
        };
      }
      return {
        title: '下一步：开始分析',
        desc: '问题已准备好。进入分析步骤，点一次即可自动完成。',
        primaryLabel: '去开始分析',
        primaryAction: () => setStage('execution'),
        secondaryLabel: '再改改问题',
        secondaryAction: () => {
          document.getElementById('requirement-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
        tips: ['分析中途可暂停或重试', '完成后会提示查看结果'],
        tone: 'success' as const,
      };
    }

    if (stage === 'execution') {
      if (!hasDataSource) {
        return {
          title: '还没有数据',
          desc: '开始分析前需要先上传数据。',
          primaryLabel: '去上传数据',
          primaryAction: () => navigate('/data-sources'),
          secondaryLabel: '返回说明问题',
          secondaryAction: () => setStage('input'),
          tips: ['先上传数据，再开始分析'],
          tone: 'warn' as const,
        };
      }
      if (isRunning) {
        return {
          title: '正在自动分析',
          desc: running ? `当前步骤：${running.label}` : '系统正在自动处理中。',
          primaryLabel: '查看分析进度',
          primaryAction: () => {
            document.getElementById('execution-timeline')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
          secondaryLabel: '暂停',
          secondaryAction: () => void workflow('pause'),
          tips: ['可在下方查看进度说明', '完成后会提示查看结果'],
          tone: 'info' as const,
        };
      }
      if (isFailed) {
        return {
          title: '分析遇到问题',
          desc: '不用担心，可以一键重试，或先改一下问题描述。',
          primaryLabel: '重试',
          primaryAction: () => void workflow('retry_current'),
          secondaryLabel: '重新分析',
          secondaryAction: () => void workflow('retry'),
          tips: ['也可返回上一步修改问题后再开始'],
          tone: 'danger' as const,
        };
      }
      if (isCompleted) {
        return {
          title: '下一步：查看结果',
          desc: '分析已完成，可以阅读结论并导出报告。',
          primaryLabel: '查看结果',
          primaryAction: () => setStage('output'),
          secondaryLabel: '再分析一次',
          secondaryAction: () => void workflow('retry'),
          tips: ['结果页支持导出 PDF / Word / Markdown'],
          tone: 'success' as const,
        };
      }
      return {
        title: '可以开始分析了',
        desc: '数据和问题都准备好了，点一次即可自动完成。',
        primaryLabel: writeEnabled ? '开始分析' : '只读角色不可开始',
        primaryAction: () => {
          if (writeEnabled) void workflow('start');
        },
        secondaryLabel: '返回检查问题',
        secondaryAction: () => setStage('input'),
        tips: ['开始后可在本页查看进度', '失败可一键重试'],
        tone: 'success' as const,
        primaryDisabled: !writeEnabled,
      };
    }

    // output
    if (!isCompleted && !reportArtifact) {
      return {
        title: '下一步：先完成分析',
        desc: '还没有可查看的结果，请先完成分析。',
        primaryLabel: '返回开始分析',
        primaryAction: () => setStage('execution'),
        secondaryLabel: '查看历史记录',
        secondaryAction: () => navigate('/history'),
        tips: ['分析完成后会自动生成报告草稿'],
        tone: 'warn' as const,
      };
    }
    return {
      title: '下一步：导出报告',
      desc: '可以精修摘要，再导出 PDF / Word / Markdown。',
      primaryLabel: '去导出报告',
      primaryAction: () => {
        document.getElementById('export-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      secondaryLabel: '打开结果列表',
      secondaryAction: () => navigate('/reports'),
      tips: ['导出前建议先看一眼摘要', '需要复用时可保存为模板'],
      tone: 'success' as const,
    };
  })();

  return (
    <div className="workspace-grid workspace-stage-grid workspace-stage-grid-enterprise workspace-wizard">
      <section className={`workspace-command-header workspace-phase-banner-${stage}`}>
        <div className="workspace-command-copy">
          <span className="workspace-breadcrumb">做分析 / 三步完成</span>
          <div className="workspace-command-title-row">
            <div>
              <span className="workspace-command-kicker">{stageMeta.code}</span>
              <h2>{activeTask.name || '我的分析'}</h2>
              <p>{stageMeta.subtitle}</p>
            </div>
            <div className="workspace-command-actions">
              <Link className="action-button secondary-button" to="/data-sources">
                换数据
              </Link>
              {stage === 'input' ? (
                <button
                  className="action-button"
                  type="button"
                  disabled={!executionGate.allowed}
                  title={executionGate.allowed ? '进入开始分析' : executionGate.reason}
                  onClick={() => setStage('execution')}
                >
                  下一步：开始分析
                </button>
              ) : null}
              {stage === 'execution' ? (
                <button
                  className="action-button"
                  type="button"
                  disabled={!outputGate.allowed}
                  title={outputGate.allowed ? '进入查看结果' : outputGate.reason}
                  onClick={() => setStage('output')}
                >
                  下一步：查看结果
                </button>
              ) : null}
              {stage === 'output' ? (
                <button
                  className="action-button"
                  type="button"
                  onClick={() => document.getElementById('export-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  去导出报告
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="workspace-wizard-steps" aria-label="分析步骤">
          {STAGES.map((item, index) => {
            const active = item.id === stage;
            const done = index < stageIndex;
            const gate = evaluateStageAccess(item.id, activeTask, intent);
            const locked = !gate.allowed;
            return (
              <button
                key={item.id}
                type="button"
                className={`workspace-wizard-step${active ? ' active' : ''}${done ? ' done' : ''}${locked ? ' locked' : ''}`}
                aria-current={active ? 'step' : undefined}
                aria-disabled={locked ? true : undefined}
                title={locked ? gate.reason : item.subtitle}
                onClick={() => {
                  if (locked) {
                    notify(gate.reason, { tone: 'warn', description: gate.ctaLabel || undefined });
                    setStage(gate.redirectTo, { force: true });
                    return;
                  }
                  setStage(item.id);
                }}
              >
                <span>{item.code}</span>
                <div>
                  <strong>{item.label}{locked ? ' · 未解锁' : ''}</strong>
                  <small>{locked ? gate.reason : item.subtitle}</small>
                </div>
              </button>
            );
          })}
        </div>

        {!stageGate.allowed ? (
          <FlowAlert
            tone="warn"
            title="当前步骤尚未解锁"
            description={stageGate.reason}
            primaryLabel={stageGate.ctaLabel || '返回可用步骤'}
            onPrimary={() => {
              if (stageGate.ctaPath) {
                navigate(stageGate.ctaPath);
                return;
              }
              setStage(stageGate.redirectTo, { force: true });
            }}
            secondaryLabel="查看当前进度"
            onSecondary={() => setStage(stage, { force: true })}
          />
        ) : null}

        <div className="workspace-overview-strip">
          <article className="workspace-overview-card workspace-overview-card-primary">
            <span>当前步骤</span>
            <strong>{stageMeta.label}</strong>
            <small>{activeTask.status}</small>
          </article>
          <article className="workspace-overview-card">
            <span>任务进度</span>
            <strong>{`${completedNodes}/${totalNodes}`}</strong>
            <small>{running ? `当前：${running.label}` : '等待开始或已完成'}</small>
          </article>
          <article className="workspace-overview-card">
            <span>数据范围</span>
            <strong>{activeTask.dataSource?.fileName ?? '还没上传数据'}</strong>
            <small>{dataSourceScope}</small>
          </article>
          <article className="workspace-overview-card">
            <span>结果与提醒</span>
            <strong>{`${artifactCount} 项结果`}</strong>
            <small>{failedNodes > 0 ? `${failedNodes} 个步骤异常` : `${activeTask.risks.length} 条待关注`}</small>
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
              <span>这一步</span>
              <strong>用一句话说清楚你想分析什么</strong>
              <p>先确认数据，再填写问题并生成分析方案。</p>
            </article>
            <article className="workspace-focus-card">
              <span>现在</span>
              <strong>{activeTask.dataSource ? '可以填写问题了' : '还没上传数据'}</strong>
              <p>{activeTask.dataSource ? `已接入 ${activeTask.dataSource.fileName}` : '先去上传一份表格或文档。'}</p>
            </article>
          </section>

          {!hasDataSource ? (
            <FlowAlert
              tone="warn"
              title="还没有可分析的数据"
              description="请先上传文件，再填写你想分析的问题。"
              primaryLabel={demoLoading ? '准备示例中…' : '不会用？先看示例'}
              primaryDisabled={!writeEnabled || demoLoading}
              onPrimary={() => {
                if (writeEnabled) void startDemo();
              }}
              secondaryLabel="去上传数据"
              onSecondary={() => navigate('/data-sources')}
            />
          ) : !hasIntent ? (
            <FlowAlert
              tone="info"
              title="数据已就绪，下一步说明问题"
              description="在下方写一句你想分析什么，再点“生成分析方案”。"
              primaryLabel="去填写问题"
              onPrimary={() => {
                document.getElementById('requirement-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          ) : (
            <FlowAlert
              tone="success"
              title="问题已准备好"
              description="可以进入下一步，开始自动分析。"
              primaryLabel="去开始分析"
              onPrimary={() => setStage('execution')}
            />
          )}

          <RequirementComposer
            initialValue={activeTask.request}
            onParse={(payload) => void parseIntent(payload)}
            readOnly={!writeEnabled}
          />

          {intent ? (
            <section className="content-card workspace-section workspace-fold-section">
              <div className="section-heading">
                <div>
                  <h3>方案详情</h3>
                  <p>系统根据你的问题整理出的分析目标与关注点。日常使用可先收起。</p>
                </div>
                <button
                  className="action-button secondary-button"
                  type="button"
                  onClick={() => setShowPlanDetails((value) => !value)}
                >
                  {showPlanDetails ? '收起方案详情' : '展开方案详情'}
                </button>
              </div>
              {showPlanDetails ? <IntentSummary summary={intent} /> : (
                <p className="status-note">已生成分析方案。需要核对目标、指标时再展开。</p>
              )}
            </section>
          ) : null}

          {activeTask.dataSource?.kind === 'document' ? (
            <section className="content-card workspace-section">
              <div className="section-heading">
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
          <div>
                <h3>当前数据</h3>
                <p>这里显示本次分析会用到的数据。需要换文件时去上传页。</p>
              </div>
            </div>
            {!activeTask.dataSource ? (
              <p className="status-note">还没上传数据。请先去上传或选择一份文件。</p>
            ) : (
              <div className="workspace-source-summary">
                <strong>{activeTask.dataSource.fileName}</strong>
                <p>{`实际分析范围：${dataSourceScope}`}</p>
              </div>
            )}
            <div className="actions-row">
              <Link className="action-button secondary-button" to="/data-sources">
                去上传数据
              </Link>
              <button className="action-button" type="button" disabled={!executionGate.allowed} title={executionGate.allowed ? '进入开始分析' : executionGate.reason} onClick={() => setStage('execution')}>
                下一步：开始分析
              </button>
            </div>
            {message ? <p className={`status-note status-note-${messageTone}`}>{message}</p> : null}
          </section>
        </>
      ) : null}

      {stage === 'execution' ? (
        <>
          <section className="workspace-focus-band">
            <article className="workspace-focus-card workspace-focus-card-live">
              <span>分析进度</span>
              <strong>{running ? `正在处理：${running.label}` : '等待开始或已完成'}</strong>
              <p>{activeTask.snapshot.logMessage || '点下方“开始分析”，系统会自动完成。'}</p>
            </article>
            <article className="workspace-focus-card">
              <span>已生成内容</span>
              <strong>{artifactCount > 0 ? `${artifactCount} 项` : '还没有'}</strong>
              <p>{artifactSummary}</p>
            </article>
          </section>

          {!hasIntent ? (
            <FlowAlert
              tone="warn"
              title="还没说明分析问题"
              description="开始前请先写清楚你想分析什么，并生成分析方案。"
              primaryLabel="返回说明问题"
              onPrimary={() => setStage('input', { force: true })}
            />
          ) : null}

          {isFailed ? (
            <FlowAlert
              tone="danger"
              title="分析遇到问题"
              description={activeTask.snapshot.logMessage || '可以一键重试，或返回上一步改改问题后再开始。'}
              primaryLabel={workflowBusy ? '处理中…' : '重试这一步'}
              primaryDisabled={workflowBusy || !writeEnabled}
              onPrimary={() => void workflow('retry_current')}
              secondaryLabel="返回说明问题"
              onSecondary={() => setStage('input', { force: true })}
            />
          ) : null}

          {isCompleted ? (
            <FlowAlert
              tone="success"
              title="分析已完成"
              description="可以去查看结论，并按需导出报告。"
              primaryLabel="查看结果"
              onPrimary={() => setStage('output', { force: true })}
            />
          ) : null}

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

          <section className="content-card workspace-section">
            <div className="section-heading">
              <div>
                <h3>分析图表</h3>
                <p>根据当前数据自动汇总生成，可切换图表类型与字段。</p>
              </div>
              <Link className="action-button secondary-button" to="/chat-analysis">
                打开图表页
              </Link>
            </div>
            <ChartBoard
              dataSource={activeTask.dataSource}
              metricArtifact={metricArtifact}
              chartArtifact={chartArtifact}
              onTitleChange={() => undefined}
            />
          </section>

          <section className="content-card workspace-section workspace-fold-section">
            <div className="section-heading">
              <div>
                <h3>更多细节（可选）</h3>
                <p>流程图、数据修正等排查信息。普通使用不必打开。</p>
              </div>
              <button
                className="action-button secondary-button"
                type="button"
                onClick={() => setShowExpertView((value) => !value)}
              >
                {showExpertView ? '收起更多细节' : '展开更多细节'}
              </button>
            </div>
            {!showExpertView ? (
              <p className="status-note">默认展示进度与图表。需要排查过程或改数据时再展开。</p>
            ) : (
              <div className="workspace-expert-panel">
                <WorkflowCanvas nodes={activeTask.snapshot.nodes} />
                {cleaningArtifact ? (
                  <section className="workspace-expert-block">
                    <h4>数据整理说明</h4>
                    <p className="status-note">系统自动做过哪些清理与修正。</p>
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
                {activeTask.dataSource?.kind === 'document' ? (
                  <section className="workspace-expert-block">
                    <h4>关键证据</h4>
                    <p className="status-note">文档里支撑结论的关键段落。</p>
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
              </div>
            )}
          </section>

          <div className="actions-row">
            <button className="action-button secondary-button" type="button" onClick={() => setStage('input')}>
              返回说明问题
            </button>
            <button className="action-button" type="button" onClick={() => setStage('output')}>
              下一步：查看结果
            </button>
          </div>
          {message ? <p className={`status-note status-note-${messageTone}`}>{message}</p> : null}
        </>
      ) : null}

      {stage === 'output' ? (
        <>
          <section className="content-card workspace-section workspace-output-hero">
            <div className="section-heading">
              <div>
                <h3>分析结果</h3>
                <p>
                  {isCompleted
                    ? '先看结论和图表，确认无误后再导出报告。'
                    : '当前还没有完整结果，可返回分析页继续执行。'}
                </p>
              </div>
              <div className="workspace-output-status-pills" aria-label="结果状态">
                <span className={`workspace-status-pill ${reportArtifact || summary ? 'is-ready' : 'is-pending'}`}>
                  {reportArtifact || summary ? '结论已生成' : '结论未生成'}
                </span>
                <span className={`workspace-status-pill ${metricArtifact || chartArtifact ? 'is-ready' : 'is-pending'}`}>
                  {metricArtifact || chartArtifact ? '图表可用' : '图表未生成'}
                </span>
                <span className={`workspace-status-pill ${activeTask.exports.length > 0 ? 'is-ready' : 'is-pending'}`}>
                  {activeTask.exports.length > 0 ? `${activeTask.exports.length} 个导出` : '尚未导出'}
                </span>
              </div>
            </div>
          </section>

          {(reportMarkdown || summary) ? (
            <section className="content-card workspace-section workspace-conclusion-card">
              <div className="section-heading">
                <div>
                  <h3>本次结论</h3>
                  <p>最重要的内容放在最上面，方便快速阅读。</p>
                </div>
              </div>
              <div className="workspace-conclusion-preview">
                {(reportMarkdown || summary).slice(0, 900)}
                {(reportMarkdown || summary).length > 900 ? '…' : ''}
              </div>
            </section>
          ) : (
            <FlowAlert
              tone="info"
              title="还没有可阅读的结论"
              description="请先完成分析，或返回上一步重新开始。"
              primaryLabel="返回开始分析"
              onPrimary={() => setStage('execution', { force: true })}
            />
          )}

          <section className="content-card workspace-section">
            <div className="section-heading">
              <div>
                <h3>分析图表</h3>
                <p>根据当前分析结果自动生成，可切换图表类型与字段。</p>
              </div>
              <Link className="action-button secondary-button" to="/chat-analysis">
                打开独立图表页
              </Link>
            </div>
            {activeTask.dataSource ? (
              <ChartBoard
                dataSource={activeTask.dataSource}
                metricArtifact={metricArtifact}
                chartArtifact={chartArtifact}
                onTitleChange={() => undefined}
              />
            ) : (
              <p className="status-note">当前没有绑定数据源，无法展示图表。</p>
            )}
          </section>

          <section className="content-card workspace-section" id="export-center">
            <div className="section-heading">
              <div>
                <h3>报告与导出</h3>
                <p>可精修摘要，并导出 PDF / Word / Markdown。</p>
              </div>
            </div>
            <ReportEditor
              summary={reportMarkdown}
              onSummaryChange={(value) => void saveSummary(value)}
              onExport={(record) => void exportReport(record)}
              onSaveTemplate={() => void saveTemplate()}
            />
            <ExportCenter
              status={message || '看完结论后，再导出你需要的格式'}
              onExport={(record) => void exportReport(record)}
              onSaveTemplate={() => void saveTemplate()}
              readOnly={!writeEnabled}
              canManageTemplates={adminEnabled}
            />
          </section>

          <div className="actions-row">
            <button className="action-button secondary-button" type="button" onClick={() => setStage('execution')}>
              返回分析
            </button>
            <Link className="action-button secondary-button" to="/reports">
              打开结果列表
            </Link>
            <Link className="action-button secondary-button" to="/history">
              查看历史
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
          {message ? <p className={`status-note status-note-${messageTone} workspace-action-rail-status`}>{message}</p> : null}
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
