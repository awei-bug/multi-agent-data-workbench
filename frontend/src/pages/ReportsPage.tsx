import { useEffect, useState } from 'react';

import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { TaskRecord } from '../types/tasks';
import { defaultWorkbenchContext } from '../types/workbench';
import { withWorkspaceQuery, workspaceFetch } from '../utils/workspaceIdentity';
import { createEmptyTask } from './emptyTask';

function ReportsPage() {
  const { activeTask, setActiveTask, setContext } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [reports, setReports] = useState<TaskRecord[]>([]);
  const [status, setStatus] = useState('等待选择报告。');

  const loadReports = () => {
    void workspaceFetch(`${apiBaseUrl}/api/history/tasks`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items) => setReports(items))
      .catch(() => setReports([]));
  };

  useEffect(loadReports, [apiBaseUrl, activeTask.id, activeTask.exports.length]);

  const reportList = activeTask.dataSource ? [activeTask, ...reports.filter((report) => report.id !== activeTask.id)] : reports;

  const deleteReport = async (report: TaskRecord) => {
    setStatus(`正在删除 ${report.name}...`);
    const isActiveReport = report.id === activeTask.id;
    const response = await workspaceFetch(
      `${apiBaseUrl}${isActiveReport ? '/api/tasks/active/report' : `/api/history/tasks/${encodeURIComponent(report.id)}`}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      setStatus('删除失败。');
      return;
    }
    if (isActiveReport) {
      setActiveTask(createEmptyTask());
      setContext(defaultWorkbenchContext);
    } else {
      setReports((current) => current.filter((item) => item.id !== report.id));
    }
    setStatus(`已彻底清除 ${report.name}。`);
    if (!isActiveReport) loadReports();
  };

  return (
    <div className="workspace-grid compact-page">
      <section className="enterprise-page-hero">
        <span className="enterprise-page-kicker">报告中心 / 交付档案</span>
        <div className="enterprise-page-title-row">
          <div>
            <h3>分析报告交付中心</h3>
            <p>统一查看持久化分析报告、导出文件和当前会话产物，支持直接下载与彻底删除。</p>
          </div>
        </div>
      </section>

      <section className="enterprise-metric-strip">
        <article className="enterprise-metric-card">
          <span>报告总数</span>
          <strong>{reportList.length}</strong>
          <small>当前可访问报告</small>
        </article>
        <article className="enterprise-metric-card">
          <span>当前会话</span>
          <strong>{activeTask.dataSource ? activeTask.name : '未生成会话报告'}</strong>
          <small>{activeTask.status}</small>
        </article>
        <article className="enterprise-metric-card">
          <span>导出记录</span>
          <strong>{reportList.reduce((sum, report) => sum + (report.exports?.length ?? 0), 0)}</strong>
          <small>累计可下载文件</small>
        </article>
        <article className="enterprise-metric-card">
          <span>当前状态</span>
          <strong>{status}</strong>
          <small>删除、导出后会即时反馈</small>
        </article>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">RC</span>
          <div>
            <h3>报告列表</h3>
            <p>查看持久化分析报告与实际生成的下载文件。</p>
          </div>
        </div>
        <div className="history-list history-list-grid">
          {reportList.map((report) => (
            <article className="history-card report-card" key={report.id}>
              <div className="history-card-header">
                <h4>{report.name}</h4>
                <span className="history-badge">{report.status}</span>
              </div>
              <p>{report.summary}</p>
              {report.dataSource?.analysisScope ? (
                <p className="status-note">
                  {`计算范围：${report.dataSource.analysisScope.rowsProcessed}/${report.dataSource.analysisScope.rowCount} 行`}
                </p>
              ) : null}
              <div className="actions-row">
                {(report.exports ?? []).map((item, index) =>
                  item.artifactId ? (
                    <a
                      className="action-button secondary-button"
                      key={`${item.artifactId}-${index}`}
                      href={withWorkspaceQuery(`${apiBaseUrl}/api/artifacts/${item.artifactId}/download`)}
                    >
                      {`下载 ${item.format}`}
                    </a>
                  ) : null,
                )}
                {report.exports?.length === 0 ? <span className="status-note">尚未生成导出文件。请先在工作台完成审核并导出。</span> : null}
                <button className="action-button secondary-button" type="button" onClick={() => void deleteReport(report)}>彻底删除</button>
              </div>
              <button className="action-button tertiary-button" type="button" onClick={() => setStatus(`报告 ${report.name} 已保存在任务历史中。`)}>查看状态</button>
            </article>
          ))}
          {reportList.length === 0 ? <p className="status-note">暂无持久化报告。请先在工作台完成分析。</p> : null}
        </div>
      </section>
    </div>
  );
}

export default ReportsPage;
