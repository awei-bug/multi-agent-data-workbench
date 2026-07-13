import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { TaskRecord } from '../types/tasks';
import { workspaceFetch } from '../utils/workspaceIdentity';

function matchesKeyword(task: TaskRecord, keyword: string) {
  if (!keyword.trim()) return true;
  const normalized = keyword.trim().toLowerCase();
  return [task.name, task.summary, task.request, task.status].some((field) => field.toLowerCase().includes(normalized));
}

function describeNodeStatus(status: string) {
  if (status === 'success') return '已完成';
  if (status === 'running') return '运行中';
  if (status === 'failed') return '失败';
  return '待执行';
}

function HistoryPage() {
  const navigate = useNavigate();
  const { setActiveTask } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    const loadTasks = async () => {
      setLoading(true);
      try {
        const response = await workspaceFetch(`${apiBaseUrl}/api/history/tasks`);
        if (!response.ok) throw new Error(`History fetch failed: ${response.status}`);
        const tasks = (await response.json()) as TaskRecord[];
        if (cancelled) return;
        setRecentTasks(tasks);
        setSelectedTaskId((current) => (tasks.some((task) => task.id === current) ? current : tasks[0]?.id ?? ''));
        setStatus('');
      } catch {
        if (!cancelled) {
          setRecentTasks([]);
          setSelectedTaskId('');
          setStatus('无法读取历史任务，请确认后端服务已启动。');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadTasks();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  const filteredTasks = useMemo(() => recentTasks.filter((task) => matchesKeyword(task, keyword)), [keyword, recentTasks]);

  useEffect(() => {
    if (filteredTasks.length === 0) {
      setSelectedTaskId('');
      return;
    }
    if (!filteredTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(filteredTasks[0].id);
    }
  }, [filteredTasks, selectedTaskId]);

  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? null;

  const activateTask = async (taskId: string) => {
    const response = await workspaceFetch(`${apiBaseUrl}/api/history/tasks/${encodeURIComponent(taskId)}/activate`, { method: 'POST' });
    if (!response.ok) {
      setStatus('回放到工作台失败。');
      return;
    }
    setActiveTask(await response.json());
    navigate('/workspace?step=execution');
  };

  return (
    <div className="workspace-grid enterprise-split history-layout">
      <section className="enterprise-page-hero">
        <span className="enterprise-page-kicker">历史任务 / 可回放任务库</span>
        <div className="enterprise-page-title-row">
          <div>
            <h3>分析任务档案中心</h3>
            <p>集中管理服务端持久化的任务快照、执行链路和导出结果，可直接把任意历史任务回放到当前工作台。</p>
          </div>
          <div className="enterprise-page-actions">
            <button className="action-button" type="button" onClick={() => navigate('/workspace?step=input')}>开始新任务</button>
            <button className="action-button secondary-button" type="button" onClick={() => navigate('/reports')}>打开报告中心</button>
          </div>
        </div>
      </section>

      <section className="enterprise-metric-strip">
        <article className="enterprise-metric-card">
          <span>历史任务</span>
          <strong>{recentTasks.length}</strong>
          <small>服务端已保存任务总数</small>
        </article>
        <article className="enterprise-metric-card">
          <span>筛选结果</span>
          <strong>{filteredTasks.length}</strong>
          <small>当前关键词命中任务</small>
        </article>
        <article className="enterprise-metric-card">
          <span>当前选中</span>
          <strong>{selectedTask?.name ?? '未选择任务'}</strong>
          <small>{selectedTask?.status ?? '等待选择'}</small>
        </article>
        <article className="enterprise-metric-card">
          <span>导出文件</span>
          <strong>{selectedTask?.exports?.length ?? 0}</strong>
          <small>当前选中任务的交付记录</small>
        </article>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">H1</span>
          <div>
            <h3>任务列表</h3>
            <p>按名称、摘要、需求和状态快速搜索历史任务。</p>
          </div>
        </div>
        <label className="composer-field" htmlFor="history-search">
          <span>搜索历史任务</span>
          <input id="history-search" type="search" placeholder="输入任务名、摘要、需求或状态" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        </label>
        {loading ? <p className="status-note">正在加载历史任务…</p> : null}
        {status ? <p className="status-note">{status}</p> : null}
        <div className="history-list">
          {filteredTasks.map((task) => (
            <article className={`history-card${selectedTask?.id === task.id ? ' active-tab-card' : ''}`} key={task.id}>
              <div className="history-card-header">
                <h4>{task.name}</h4>
                <span className="history-badge">{task.status}</span>
              </div>
              <p>{task.summary}</p>
              <div className="actions-row">
                <button className="action-button secondary-button" type="button" onClick={() => setSelectedTaskId(task.id)}>查看详情</button>
                <button className="action-button" type="button" onClick={() => void activateTask(task.id)}>回放到工作台</button>
              </div>
            </article>
          ))}
          {!loading && filteredTasks.length === 0 ? <p className="status-note">暂无历史任务。</p> : null}
        </div>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">H2</span>
          <div>
            <h3>任务详情</h3>
            <p>展示当前选中任务的需求、节点状态和交付结果。</p>
          </div>
        </div>
        {selectedTask ? (
          <>
            <div className="summary-grid summary-grid-strong">
              <div className="summary-card"><span>任务名称</span><strong>{selectedTask.name}</strong></div>
              <div className="summary-card"><span>当前状态</span><strong>{selectedTask.status}</strong></div>
              <div className="summary-card"><span>导出记录</span><strong>{selectedTask.exports?.length ?? 0}</strong></div>
              <div className="summary-card"><span>节点数量</span><strong>{selectedTask.snapshot.nodes.length}</strong></div>
            </div>
            <p className="status-note">{selectedTask.request || '无需求文本'}</p>
            <div className="history-list">
              {selectedTask.snapshot.nodes.map((node) => (
                <article className="history-card" key={node.id}>
                  <div className="history-card-header">
                    <h4>{node.label}</h4>
                    <span className="history-badge">{describeNodeStatus(node.status)}</span>
                  </div>
                </article>
              ))}
            </div>
            <div className="actions-row">
              <button className="action-button" type="button" onClick={() => void activateTask(selectedTask.id)}>回放到执行编排</button>
              <button className="action-button secondary-button" type="button" onClick={() => navigate('/workspace?step=output')}>查看报告交付</button>
            </div>
          </>
        ) : (
          <p className="status-note">选择左侧任务以查看详情。</p>
        )}
      </section>
    </div>
  );
}

export default HistoryPage;
