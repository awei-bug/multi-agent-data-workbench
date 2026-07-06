import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createMockTaskRepository } from '../mock/mockTaskRepository';

const repository = createMockTaskRepository();

type ReportRecord = ReturnType<typeof repository.listRecentTasks>[number];

function ReportsPage() {
  const navigate = useNavigate();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;
  const [reports, setReports] = useState<ReportRecord[]>(() => repository.listRecentTasks());
  const [status, setStatus] = useState('等待选择报告操作');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    if (!apiBaseUrl) return;
    let cancelled = false;
    void fetch(`${apiBaseUrl}/api/reports`)
      .then((response) => (response.ok ? response.json() : repository.listRecentTasks()))
      .then((nextReports: ReportRecord[]) => {
        if (!cancelled) setReports(nextReports);
      })
      .catch(() => {
        if (!cancelled) setReports(repository.listRecentTasks());
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  const replayReport = (report: ReportRecord) => {
    repository.loadTaskIntoWorkspace(report.id);
    setStatus(`已载入任务回放：${report.name}`);
    navigate('/workspace');
  };

  const filteredReports =
    statusFilter === 'all' ? reports : reports.filter((report) => (statusFilter === 'review' ? report.status.includes('复核') : report.status.includes('导出')));

  return (
    <div className="workspace-grid">
      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">RC</span>
          <div>
            <h3>报告中心</h3>
            <p>管理多 Agent 生成的分析报告，支持查看、下载、分享和重新发起分析。</p>
          </div>
        </div>
        <div className="log-card context-block-log-success">
          <strong>操作反馈</strong>
          <p>{status}</p>
        </div>
        <div className="actions-row report-filter-bar">
          <label className="composer-field" htmlFor="report-status-filter">
            <span>状态筛选</span>
            <select id="report-status-filter" className="text-input" aria-label="报告状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部报告</option>
              <option value="review">待复核</option>
              <option value="exported">已导出</option>
            </select>
          </label>
          <label className="composer-field" htmlFor="report-time-filter">
            <span>时间筛选</span>
            <input id="report-time-filter" className="text-input" type="date" aria-label="报告时间筛选" />
          </label>
        </div>
        <div className="history-list history-list-grid">
          {filteredReports.map((report) => (
            <article className="history-card report-card" key={report.id}>
              <div className="history-card-header">
                <h4>{report.name}</h4>
                <span className="history-badge">{report.time}</span>
              </div>
              <p>{report.summary}</p>
              <div className="chart-preview report-thumbnail" aria-label={`${report.name} 缩略图`} />
              <div className="actions-row">
                <button className="action-button" type="button" onClick={() => setStatus(`已打开：${report.name}`)}>
                  查看
                </button>
                <button className="action-button secondary-button" type="button" onClick={() => setStatus(`PDF 下载已生成：${report.name}`)}>
                  下载 PDF
                </button>
                <button
                  className="action-button secondary-button"
                  type="button"
                  onClick={() => {
                    repository.loadTaskIntoWorkspace(report.id);
                    setStatus(`已基于 ${report.name} 重新发起分析`);
                    navigate('/workspace');
                  }}
                >
                  重新分析
                </button>
                <button className="action-button secondary-button" type="button" onClick={() => replayReport(report)}>
                  任务回放
                </button>
                <button
                  className="action-button tertiary-button"
                  type="button"
                  onClick={() => {
                    repository.saveActiveTaskAsTemplate({ name: report.name, request: report.request, summary: report.summary });
                    setStatus(`已另存为模板：${report.name}`);
                  }}
                >
                  另存为模板
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default ReportsPage;
