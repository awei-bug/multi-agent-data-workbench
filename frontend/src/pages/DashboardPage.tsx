import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { TaskRecord } from '../types/tasks';
import { buildContinuePlan } from '../utils/continuePlan';
import { runFullDemoFlow, type DemoProgress } from '../utils/demoFlow';
import { canWrite } from '../utils/permissions';
import { workspaceFetch } from '../utils/workspaceIdentity';
import DemoProgressBar from '../components/demo/DemoProgressBar';

function phaseLabel(phase?: string) {
  switch (phase) {
    case 'running':
      return '执行中';
    case 'paused':
      return '已暂停';
    case 'failed':
      return '失败';
    case 'completed':
      return '已完成';
    case 'needs_review':
      return '待审核';
    case 'stopped':
      return '已终止';
    default:
      return '待启动';
  }
}

function DashboardPage() {
  const navigate = useNavigate();
  const { activeTask, setActiveTask, setContext } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState('');
  const [demoProgress, setDemoProgress] = useState<DemoProgress | null>(null);
  const writeEnabled = canWrite();

  useEffect(() => {
    if (!apiBaseUrl) return;
    const controller = new AbortController();
    void workspaceFetch(`${apiBaseUrl}/api/history/tasks`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((tasks: TaskRecord[]) => setRecentTasks(tasks))
      .catch(() => setRecentTasks([]));
    return () => controller.abort();
  }, [apiBaseUrl]);

  const completedCount = activeTask.snapshot.nodes.filter((node) => node.status === 'success').length;
  const runningCount = activeTask.snapshot.nodes.filter((node) => node.status === 'running').length;
  const pendingCount = activeTask.snapshot.nodes.filter((node) => node.status === 'pending').length;
  const failedCount = activeTask.snapshot.nodes.filter((node) => node.status === 'failed').length;
  const finishedTasks = recentTasks.filter((task) => task.snapshot.phase === 'completed').length;
  const exportedCount = recentTasks.reduce((sum, task) => sum + task.exports.length, 0);
  const completionRate = `${Math.round((finishedTasks / Math.max(recentTasks.length, 1)) * 100)}%`;
  const activeNode = activeTask.snapshot.nodes.find((node) => node.status === 'running');
  const plan = useMemo(() => buildContinuePlan(activeTask), [activeTask]);
  const phase = String(activeTask.snapshot.phase || 'idle');

  const startDemo = async () => {
    if (!writeEnabled || demoLoading) return;
    setDemoLoading(true);
    setDemoMessage('正在启动完整示例演示…');
    try {
      const result = await runFullDemoFlow({
        apiBaseUrl,
        currentTask: activeTask,
        autoStart: true,
        onProgress: (progress) => {
          setDemoProgress(progress);
          setDemoMessage(progress.detail || progress.label);
        },
        onTask: (task) => {
          setActiveTask(task);
          if (task.snapshot?.context) setContext(task.snapshot.context);
        },
      });
      if (result.reachedDelivery) {
        setDemoMessage('示例演示完成，正在进入报告交付…');
        navigate('/workspace?step=output');
      } else {
        setDemoMessage(result.task.snapshot.phase === 'failed' ? '演示执行失败，请到执行页处理。' : '示例已启动，正在进入执行页…');
        navigate('/workspace?step=execution');
      }
    } catch {
      setDemoProgress({ stage: 'error', percent: 100, label: '演示失败', detail: '请稍后重试或检查后端服务。' });
      setDemoMessage('示例演示启动失败，请稍后重试。');
    } finally {
      setDemoLoading(false);
    }
  };

  const pathSteps = useMemo(
    () => [
      {
        code: '01',
        label: '数据源',
        done: Boolean(activeTask.dataSource),
        current: !activeTask.dataSource,
        path: '/data-sources',
        value: activeTask.dataSource ? activeTask.dataSource.fileName : '未接入',
      },
      {
        code: '02',
        label: '输入准备',
        done: Boolean(activeTask.request && activeTask.request !== '尚未填写分析需求。'),
        current: Boolean(activeTask.dataSource) && phase === 'idle',
        path: '/workspace?step=input',
        value:
          activeTask.request && activeTask.request !== '尚未填写分析需求。'
            ? '需求已填写'
            : '待填写需求',
      },
      {
        code: '03',
        label: '执行监控',
        done: ['completed', 'needs_review', 'stopped'].includes(phase),
        current: ['running', 'paused', 'failed'].includes(phase),
        path: '/workspace?step=execution',
        value: phaseLabel(phase),
      },
      {
        code: '04',
        label: '报告交付',
        done: ['completed', 'needs_review'].includes(phase) && activeTask.exports.length > 0,
        current: ['completed', 'needs_review'].includes(phase),
        path: '/workspace?step=output',
        value: activeTask.exports.length > 0 ? `${activeTask.exports.length} 个导出` : '待导出',
      },
    ],
    [activeTask, phase],
  );

  const risks =
    activeTask.risks.length > 0
      ? activeTask.risks
      : [
          !activeTask.dataSource ? '当前会话还没有绑定真实数据源。' : '',
          !activeTask.request || activeTask.request === '尚未填写分析需求。'
            ? '分析需求尚未填写。'
            : '',
          failedCount > 0 ? `当前有 ${failedCount} 个失败节点待处理。` : '',
        ].filter(Boolean);

  return (
    <div className="workspace-grid dashboard-page dashboard-command-grid dashboard-ops">
      <section className={`dashboard-continue-card tone-${plan.tone}`}>
        <div className="dashboard-continue-copy">
          <span className="dashboard-continue-kicker">当前最该做的事 · {plan.code}</span>
          <h3>{plan.title}</h3>
          <p>{plan.desc}</p>
          <div className="dashboard-continue-meta">
            <span>会话</span>
            <strong>{activeTask.name}</strong>
            <span>状态</span>
            <strong>{activeTask.status}</strong>
            <span>数据源</span>
            <strong>{activeTask.dataSource?.fileName || '未绑定'}</strong>
            <span>执行焦点</span>
            <strong>{activeNode?.label || phaseLabel(phase)}</strong>
          </div>
        </div>
        <div className="dashboard-continue-actions">
          <button className="action-button" type="button" onClick={() => navigate(plan.primaryPath)}>
            {plan.primaryLabel}
          </button>
          <button
            className="action-button secondary-button"
            type="button"
            onClick={() => navigate(plan.secondaryPath)}
          >
            {plan.secondaryLabel}
          </button>
          <button
            className="action-button tertiary-button"
            type="button"
            disabled={!writeEnabled || demoLoading}
            onClick={() => void startDemo()}
          >
            {demoLoading ? '准备示例中…' : '一键示例演示'}
          </button>
          <button
            className="action-button tertiary-button"
            type="button"
            onClick={() => navigate('/history')}
          >
            查看历史任务
          </button>
          {demoMessage ? <p className="status-note dashboard-demo-note">{demoMessage}</p> : null}
        </div>
      </section>

      <DemoProgressBar progress={demoProgress} />

      <section className="dashboard-command-strip dashboard-ops-metrics">
        <article className="dashboard-command-metric dashboard-command-metric-primary">
          <span>当前会话</span>
          <strong>{activeTask.name}</strong>
          <small>{activeTask.status}</small>
        </article>
        <article className="dashboard-command-metric">
          <span>节点进度</span>
          <strong>{`${completedCount}/${activeTask.snapshot.nodes.length}`}</strong>
          <small>{activeNode ? `运行中：${activeNode.label}` : `阶段：${phaseLabel(phase)}`}</small>
        </article>
        <article className="dashboard-command-metric">
          <span>历史完成率</span>
          <strong>{completionRate}</strong>
          <small>{`${finishedTasks}/${recentTasks.length || 0} 个任务完成`}</small>
        </article>
        <article className="dashboard-command-metric">
          <span>累计交付</span>
          <strong>{exportedCount}</strong>
          <small>已生成导出文件</small>
        </article>
      </section>

      <section className="dashboard-path-board">
        <div className="section-heading">
          <span className="section-index">PATH</span>
          <div>
            <h3>标准操作路径</h3>
            <p>按顺序推进。当前步骤会高亮，点击即可续做。</p>
          </div>
        </div>
        <div className="dashboard-path-steps">
          {pathSteps.map((step, index) => (
            <button
              key={step.code}
              type="button"
              className={`dashboard-path-step${step.current ? ' current' : ''}${step.done ? ' done' : ''}`}
              onClick={() => navigate(step.path)}
            >
              <span>{step.code}</span>
              <div>
                <strong>
                  {index + 1}. {step.label}
                </strong>
                <small>{step.value}</small>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="content-card workspace-section dashboard-panel dashboard-panel-wide">
        <div className="section-heading">
          <span className="section-index">AG</span>
          <div>
            <h3>Agent 执行态势</h3>
            <p>直接看状态分布和当前节点，再决定是否进入执行链路。</p>
          </div>
        </div>
        <div className="dashboard-agent-grid">
          <div className="dashboard-agent-donut">
            <div className="dashboard-agent-ring">
              <div>
                <strong>{activeTask.snapshot.nodes.length}</strong>
                <span>总节点</span>
              </div>
            </div>
            <div className="agent-state-list">
              <span>
                <i style={{ background: '#30b47f' }} />
                已完成 {completedCount}
              </span>
              <span>
                <i style={{ background: '#2157d5' }} />
                运行中 {runningCount}
              </span>
              <span>
                <i style={{ background: '#93a3b5' }} />
                待执行 {pendingCount}
              </span>
              <span>
                <i style={{ background: '#d24747' }} />
                异常 {failedCount}
              </span>
            </div>
          </div>
          <div className="dashboard-agent-board">
            <div className="summary-grid summary-grid-strong">
              <div className="summary-card">
                <span>已完成</span>
                <strong>{completedCount}</strong>
              </div>
              <div className="summary-card">
                <span>运行中</span>
                <strong>{runningCount}</strong>
              </div>
              <div className="summary-card">
                <span>待执行</span>
                <strong>{pendingCount}</strong>
              </div>
              <div className="summary-card">
                <span>异常</span>
                <strong>{failedCount}</strong>
              </div>
            </div>
            <div className="dashboard-inline-log">
              <span>当前执行节点</span>
              <strong>{activeNode?.label ?? '尚未进入执行阶段'}</strong>
              <small>
                {activeNode
                  ? `当前节点状态：${activeNode.status}`
                  : '可先接入数据并解析需求，再启动任务。'}
              </small>
            </div>
            <div className="actions-row">
              <button
                className="action-button"
                type="button"
                onClick={() => navigate('/workspace?step=execution')}
              >
                查看执行链路
              </button>
              <button
                className="action-button tertiary-button"
                type="button"
                onClick={() => navigate('/chat-analysis')}
              >
                查看数据洞察
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="content-card workspace-section dashboard-panel">
        <div className="section-heading">
          <span className="section-index">RT</span>
          <div>
            <h3>最近分析任务</h3>
            <p>可直接续做，不只是展示列表。</p>
          </div>
        </div>
        <div className="dashboard-task-list">
          {recentTasks.slice(0, 4).map((task) => {
            const taskPlan = buildContinuePlan(task);
            return (
              <article className="dashboard-task-item dashboard-task-item-ops" key={task.id}>
                <div className="history-card-header">
                  <h4>{task.name}</h4>
                  <span className="history-badge">{task.status}</span>
                </div>
                <p>{task.summary}</p>
                <div className="actions-row">
                  <button
                    className="action-button secondary-button"
                    type="button"
                    onClick={() => navigate(taskPlan.primaryPath)}
                  >
                    续做：{taskPlan.primaryLabel}
                  </button>
                </div>
              </article>
            );
          })}
          {recentTasks.length === 0 ? (
            <p className="status-note">暂无已保存的真实分析任务。完成一次分析后会出现在这里。</p>
          ) : null}
        </div>
      </section>

      <section className="content-card workspace-section dashboard-panel">
        <div className="section-heading">
          <span className="section-index">AL</span>
          <div>
            <h3>风险与待处理事项</h3>
            <p>优先处理阻塞流程的问题。</p>
          </div>
        </div>
        <div className="dashboard-risk-list">
          {(risks.length ? risks : ['当前没有明显阻塞项，可继续推进分析。']).map((risk) => (
            <div className="dashboard-risk-item" key={risk}>
              <span>待处理</span>
              <strong>{risk}</strong>
            </div>
          ))}
        </div>
        <div className="actions-row">
          <button className="action-button" type="button" onClick={() => navigate(plan.primaryPath)}>
            一键处理：{plan.primaryLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export default DashboardPage;
