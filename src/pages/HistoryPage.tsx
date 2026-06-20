import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import { createMockTaskRepository } from '../mock/mockTaskRepository';
import type { TaskRecord } from '../types/tasks';

const reusableTemplates = [
  {
    name: '经营复盘模板',
    tag: '推荐',
    description: '适合周期性经营复盘、管理层摘要和标准化汇报场景。',
    request: '分析 2025 年月度销售趋势并准备管理报告。',
    summary: '复用经营复盘模板，加载示例数据，解析需求并启动主流程。',
  },
  {
    name: '异常排查模板',
    tag: '排障',
    description: '适合检查指标波动、整理归因说明并追踪风险项。',
    request: '复盘渠道 ROI 波动并整理周会材料。',
    summary: '复用异常排查模板，加载示例数据并检查异常变化路径。',
  },
];

const repository = createMockTaskRepository();

function matchesKeyword(task: TaskRecord, keyword: string) {
  if (!keyword.trim()) {
    return true;
  }

  const normalized = keyword.trim().toLowerCase();
  return [task.name, task.summary, task.request, task.status].some((field) => field.toLowerCase().includes(normalized));
}

function describeNodeStatus(status: string) {
  if (status === 'success') {
    return '已完成';
  }

  if (status === 'running') {
    return '运行中';
  }

  if (status === 'failed') {
    return '失败';
  }

  return '待执行';
}

function HistoryPage() {
  const navigate = useNavigate();
  const { setActiveTask } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;
  const [recentTasks, setRecentTasks] = useState(() => repository.listRecentTasks());
  const [selectedTaskId, setSelectedTaskId] = useState(() => repository.listRecentTasks()[0]?.id ?? '');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(Boolean(apiBaseUrl));

  useEffect(() => {
    let cancelled = false;

    const loadTasks = async () => {
      setLoading(true);
      try {
        if (!apiBaseUrl) {
          const tasks = repository.listRecentTasks();

          if (cancelled) {
            return;
          }

          setRecentTasks(tasks);
          setSelectedTaskId((current) => (tasks.some((task) => task.id === current) ? current : tasks[0]?.id ?? ''));
          setLoading(false);
          return;
        }

        const response = await fetch(`${apiBaseUrl}/api/history/tasks`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`History fetch failed: ${response.status}`);
        }

        const tasks = (await response.json()) as TaskRecord[];

        if (cancelled) {
          return;
        }

        setRecentTasks(tasks);
        setSelectedTaskId((current) => (tasks.some((task) => task.id === current) ? current : tasks[0]?.id ?? ''));
      } catch {
        const tasks = repository.listRecentTasks();

        if (cancelled) {
          return;
        }

        setRecentTasks(tasks);
        setSelectedTaskId((current) => (tasks.some((task) => task.id === current) ? current : tasks[0]?.id ?? ''));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
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
      return;
    }

    if (!filteredTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(filteredTasks[0].id);
    }
  }, [filteredTasks, selectedTaskId]);

  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? recentTasks[0] ?? null;

  const handleSelectTask = async (taskId: string) => {
    if (!apiBaseUrl) {
      const detail = repository.getTaskDetail(taskId);

      if (detail) {
        setSelectedTaskId(detail.id);
      }

      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/history/tasks/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`History detail fetch failed: ${response.status}`);
      }

      const detail = (await response.json()) as TaskRecord | null;

      if (!detail) {
        return;
      }

      setRecentTasks((current) => current.map((task) => (task.id === detail.id ? detail : task)));
      setSelectedTaskId(detail.id);
    } catch {
      const detail = repository.getTaskDetail(taskId);

      if (detail) {
        setSelectedTaskId(detail.id);
      }
    }
  };

  const loadSelectedTask = () => {
    if (!selectedTask) {
      return;
    }

    if (apiBaseUrl) {
      setActiveTask({
        ...selectedTask,
        mode: 'replay',
        status: `回放模式 - ${selectedTask.status}`,
      });
      return;
    }

    const activeTask = repository.loadTaskIntoWorkspace(selectedTask.id);

    if (activeTask) {
      setActiveTask(activeTask);
    }
  };

  const handleLoadToWorkspace = () => {
    loadSelectedTask();
    navigate('/workspace');
  };

  const handleLoadToAsyncWorkspace = () => {
    loadSelectedTask();
    navigate('/workspace-async');
  };

  const handleUseTemplate = (template: (typeof reusableTemplates)[number]) => {
    const activeTask = repository.createTaskFromTemplate({
      name: template.name,
      request: template.request,
      summary: template.summary,
    });

    setActiveTask(activeTask);
    navigate('/workspace');
  };

  return (
    <div className="workspace-grid history-layout">
      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">H1</span>
          <div>
            <h3>最近任务</h3>
            <p>查看最近生成的分析任务、导出记录以及最新协作状态。</p>
          </div>
        </div>
        <label className="composer-field" htmlFor="history-search">
          <span>搜索历史</span>
          <input
            id="history-search"
            type="search"
            placeholder="搜索任务名称 / 摘要 / 需求 / 状态"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        {loading ? (
          <div className="history-detail-block">
            <h4>正在加载任务列表</h4>
            <p>页面已切换，正在读取历史任务和复盘详情。</p>
          </div>
        ) : null}
        <div className="history-list">
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <article className="history-card" key={task.id}>
                <div className="history-card-header">
                  <div>
                    <h4>{task.name}</h4>
                    <p>{task.summary.split('\n')[0]}</p>
                  </div>
                  <span className="history-badge">{task.status}</span>
                </div>
                <p className="history-meta">{task.time}</p>
                <div className="actions-row">
                  <button className="action-button secondary-button" type="button" onClick={() => handleSelectTask(task.id)}>
                    查看任务详情
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="history-detail-block">
              <h4>没有匹配任务</h4>
              <p>尝试放宽关键词，或从可复用模板重新发起任务。</p>
            </div>
          )}
        </div>
      </section>

      <section className="content-card workspace-section history-detail-panel" aria-label="任务复盘详情">
        <div className="section-heading">
          <span className="section-index">H1+</span>
          <div>
            <h3>任务复盘详情</h3>
            <p>在复用前检查该任务的需求、执行状态、导出记录和关键风险。</p>
          </div>
        </div>
        {selectedTask ? (
          <>
            <div className="summary-grid">
              <div className="summary-card">
                <span>任务名称</span>
                <strong>{selectedTask.name}</strong>
              </div>
              <div className="summary-card">
                <span>任务需求</span>
                <strong>{selectedTask.request}</strong>
              </div>
            </div>
            <div className="history-detail-block">
              <h4>任务摘要</h4>
              <ul className="context-risk-list">
                {selectedTask.summary
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean)
                  .map((item) => (
                    <li key={item}>{item}</li>
                  ))}
              </ul>
            </div>
            {selectedTask.dataSource ? (
              <div className="history-detail-block">
                <h4>数据源</h4>
                <p>{selectedTask.dataSource.fileName}</p>
                <p>{`CSV / ${selectedTask.dataSource.columnCount} 列 / ${selectedTask.dataSource.rowCount} 行样例`}</p>
                <ul className="context-risk-list">
                  {selectedTask.dataSource.fieldMappings.length > 0 ? (
                    selectedTask.dataSource.fieldMappings.map((item) => (
                      <li key={`${item.source}-${item.target}`}>{`${item.source} -> ${item.target}`}</li>
                    ))
                  ) : (
                    <li>字段映射尚未确认。</li>
                  )}
                </ul>
              </div>
            ) : null}
            <div className="actions-row">
              <button className="action-button" type="button" onClick={handleLoadToWorkspace}>
                载入同步工作台
              </button>
              <button className="action-button secondary-button" type="button" onClick={handleLoadToAsyncWorkspace}>
                载入异步工作台
              </button>
            </div>
            <div className="history-detail-block">
              <h4>Agent 状态</h4>
              <ul className="context-risk-list">
                {selectedTask.snapshot.nodes.map((node) => (
                  <li key={node.id}>{`${node.label}: ${describeNodeStatus(node.status)}`}</li>
                ))}
              </ul>
            </div>
            <div className="history-detail-block">
              <h4>回放时间线</h4>
              <ul className="context-risk-list">
                {(selectedTask.executionLog ?? []).length > 0 ? (
                  selectedTask.executionLog!.map((item, index) => (
                    <li key={`${item.kind}-${item.message}-${index}`}>{`${item.kind} - ${item.message}`}</li>
                  ))
                ) : (
                  <li>暂无回放日志。</li>
                )}
              </ul>
            </div>
            <div className="history-detail-block">
              <h4>导出记录</h4>
              <ul className="context-risk-list">
                {selectedTask.exports.map((item) => (
                  <li key={`${selectedTask.id}-${item.format}`}>{item.status}</li>
                ))}
              </ul>
            </div>
            <div className="history-detail-block">
              <h4>风险摘要</h4>
              <ul className="context-risk-list">
                {selectedTask.risks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <div className="history-detail-block">
            <h4>未选择任务</h4>
            <p>当前筛选条件下没有可查看的任务。</p>
          </div>
        )}
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">H2</span>
          <div>
            <h3>模板复用</h3>
            <p>从验证过的模板快速发起新任务，缩短主流程配置时间。</p>
          </div>
        </div>
        <div className="history-list">
          {reusableTemplates.map((template) => (
            <article className="history-card" key={template.name}>
              <div className="history-card-header">
                <h4>{template.name}</h4>
                <span className="history-badge history-badge-secondary">{template.tag}</span>
              </div>
              <p>{template.description}</p>
              <div className="actions-row">
                <button className="action-button secondary-button" type="button" onClick={() => handleUseTemplate(template)}>
                  使用模板
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default HistoryPage;
