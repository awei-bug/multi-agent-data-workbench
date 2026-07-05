import { useState } from 'react';

import { createMockTaskRepository } from '../mock/mockTaskRepository';

const repository = createMockTaskRepository();

function ReportsPage() {
  const reports = repository.listRecentTasks();
  const [status, setStatus] = useState('等待选择报告操作');

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
        <div className="history-list history-list-grid">
          {reports.map((report) => (
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
                <button className="action-button secondary-button" type="button" onClick={() => setStatus(`已基于 ${report.name} 重新发起分析`)}>
                  重新分析
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
