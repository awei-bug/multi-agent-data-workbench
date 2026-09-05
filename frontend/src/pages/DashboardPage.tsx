import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import DemoProgressBar from '../components/demo/DemoProgressBar';
import PageSkeleton from '../components/feedback/PageSkeleton';
import { usePageFeedback } from '../components/feedback/usePageFeedback';
import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { TaskRecord } from '../types/tasks';
import { buildContinuePlan } from '../utils/continuePlan';
import { runFullDemoFlow, type DemoProgress } from '../utils/demoFlow';
import { isDemoFlowEnabled } from '../utils/workspaceIdentity';
import { buildMainFlowGuide } from '../utils/mainFlowGuide';
import { canWrite } from '../utils/permissions';
import { workspaceFetch } from '../utils/workspaceIdentity';

function DashboardPage() {
  const navigate = useNavigate();
  const { activeTask, setActiveTask, setContext } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState('');
  const { notify } = usePageFeedback();
  const [demoProgress, setDemoProgress] = useState<DemoProgress | null>(null);
  const writeEnabled = canWrite();

  useEffect(() => {
    if (!apiBaseUrl) {
      setRecentLoading(false);
      return;
    }
    const controller = new AbortController();
    setRecentLoading(true);
    void workspaceFetch(`${apiBaseUrl}/api/history/tasks`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((tasks: TaskRecord[]) => setRecentTasks(tasks))
      .catch(() => setRecentTasks([]))
      .finally(() => setRecentLoading(false));
    return () => controller.abort();
  }, [apiBaseUrl]);

  const plan = useMemo(() => buildContinuePlan(activeTask), [activeTask]);
  const guide = useMemo(() => buildMainFlowGuide(activeTask), [activeTask]);
  const hasData = Boolean(activeTask.dataSource);
  const stepIndex = guide.steps.findIndex((step) => step.current) + 1;

  const startDemo = async () => {
    if (!writeEnabled || demoLoading) return;
    if (!isDemoFlowEnabled()) {
      setDemoMessage('生产环境已关闭示例演示，请上传真实数据开始分析。');
      notify('示例演示已关闭', { description: '生产环境仅支持真实数据流程。', tone: 'warn' });
      return;
    }
    setDemoLoading(true);
    setDemoMessage('正在准备示例数据和分析…');
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
        setDemoMessage('示例完成，正在打开结果…');
        notify('示例完成', { description: '可以直接查看结论和导出报告。', tone: 'success' });
        navigate('/workspace?step=output');
      } else {
        setDemoMessage(result.task.snapshot.phase === 'failed' ? '示例执行遇到问题，请到分析页处理。' : '示例已启动，正在进入分析…');
        navigate('/workspace?step=execution');
      }
    } catch {
      setDemoProgress({ stage: 'error', percent: 100, label: '演示失败', detail: '请稍后重试或检查后端服务。' });
      setDemoMessage('示例启动失败，请稍后重试。');
      notify('示例启动失败', { description: '请稍后重试。', tone: 'danger' });
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="workspace-grid dashboard-page dashboard-home dashboard-home-v2">
      <section className={`dashboard-hero-v2 tone-${plan.tone}`}>
        <div className="dashboard-hero-v2-main">
          <p className="dashboard-hero-kicker">主流程 · 第 {stepIndex || 1} / 4 步</p>
          <h3>{guide.title}</h3>
          <p className="dashboard-hero-desc">{guide.description}</p>

          <ol className="dashboard-step-rail" aria-label="分析步骤">
            {guide.steps.map((step) => (
              <li
                key={step.id}
                className={`${step.done ? 'done' : ''} ${step.current ? 'current' : ''}`}
              >
                <button type="button" onClick={() => navigate(step.path)}>
                  <span>{step.done && !step.current ? '✓' : step.index}</span>
                  <em>{step.label}</em>
                </button>
              </li>
            ))}
          </ol>

          <div className="dashboard-hero-cta">
            <button className="action-button dashboard-hero-primary" type="button" onClick={() => navigate(guide.primaryPath)}>
              {guide.primaryLabel}
            </button>
            <button
              className="action-button secondary-button"
              type="button"
              disabled={!writeEnabled || demoLoading}
              onClick={() => void startDemo()}
            >
              {demoLoading ? '准备示例中…' : '先看示例'}
            </button>
          </div>
          {demoMessage ? <p className="status-note dashboard-demo-note">{demoMessage}</p> : null}
          <p className="dashboard-hero-tip">{guide.tip}</p>
        </div>

        <aside className="dashboard-hero-aside" aria-label="怎么用">
          <p className="dashboard-hero-aside-title">怎么用</p>
          <ol className="dashboard-how-list">
            <li>
              <strong>上传</strong>
              <span>Excel / CSV / PDF</span>
            </li>
            <li>
              <strong>提问</strong>
              <span>一句话说清要分析什么</span>
            </li>
            <li>
              <strong>自动分析</strong>
              <span>点一次，系统出图与结论</span>
            </li>
            <li>
              <strong>看结果</strong>
              <span>阅读并导出报告</span>
            </li>
          </ol>
        </aside>
      </section>

      <DemoProgressBar progress={demoProgress} />

      <section className="dashboard-bottom-grid">
        <article className="content-card workspace-section dashboard-panel dashboard-status-card">
          <div className="section-heading">
            <div>
              <h3>当前进度</h3>
              <p>会话状态一览，继续请用上方主按钮。</p>
            </div>
          </div>
          <div className="dashboard-home-status">
            <div>
              <span>任务</span>
              <strong>{activeTask.name || '我的分析'}</strong>
            </div>
            <div>
              <span>数据</span>
              <strong>{activeTask.dataSource?.fileName || '还没上传'}</strong>
            </div>
            <div>
              <span>下一步</span>
              <strong>{plan.primaryLabel}</strong>
            </div>
          </div>
          <div className="actions-row dashboard-status-links">
            {hasData ? (
              <button className="action-button tertiary-button" type="button" onClick={() => navigate('/data-sources')}>
                换一份数据
              </button>
            ) : (
              <button className="action-button tertiary-button" type="button" onClick={() => navigate('/templates')}>
                看看常用模板
              </button>
            )}
          </div>
        </article>

        <article className="content-card workspace-section dashboard-panel dashboard-recent-card">
          <div className="section-heading">
            <div>
              <h3>最近分析</h3>
              <p>接着上次做，点继续即可。</p>
            </div>
          </div>
          {recentLoading ? (
            <PageSkeleton title="最近任务加载中" description="正在读取可继续的分析…" cards={2} rows={2} compact />
          ) : null}
          <div className="dashboard-task-list">
            {recentTasks.slice(0, 3).map((task) => {
              const taskPlan = buildContinuePlan(task);
              return (
                <article className="dashboard-task-item dashboard-task-item-ops" key={task.id}>
                  <div className="history-card-header">
                    <h4>{task.name}</h4>
                    <span className="history-badge">{task.status}</span>
                  </div>
                  <p>{task.summary || '暂无摘要'}</p>
                  <div className="actions-row">
                    <button
                      className="action-button secondary-button"
                      type="button"
                      onClick={() => navigate(taskPlan.primaryPath)}
                    >
                      继续
                    </button>
                  </div>
                </article>
              );
            })}
            {!recentLoading && recentTasks.length === 0 ? (
              <p className="status-note">完成一次分析后，记录会出现在这里。</p>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}

export default DashboardPage;
