import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import EmptyState from '../components/feedback/EmptyState';
import PageSkeleton from '../components/feedback/PageSkeleton';
import { usePageFeedback } from '../components/feedback/usePageFeedback';
import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { TaskRecord } from '../types/tasks';
import { defaultWorkbenchContext } from '../types/workbench';
import { withTicketQuery, workspaceFetch } from '../utils/workspaceIdentity';
import { createEmptyTask } from './emptyTask';

function ReportsPage() {
  const { activeTask, setActiveTask, setContext } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [reports, setReports] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const { status, setStatus, notify } = usePageFeedback('等待选择结果。');

  const loadReports = () => {
    setLoading(true);
    void workspaceFetch(`${apiBaseUrl}/api/history/tasks`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items) => setReports(items))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  };

  useEffect(loadReports, [apiBaseUrl, activeTask.id, activeTask.exports.length]);

  const historyReports = useMemo(
    () => reports.filter((report) => report.id !== activeTask.id),
    [reports, activeTask.id],
  );
  const hasCurrent = Boolean(activeTask.dataSource);
  const exportCount =
    (activeTask.exports?.length ?? 0) + historyReports.reduce((sum, report) => sum + (report.exports?.length ?? 0), 0);
  const conclusionText = String(activeTask.summary || '').trim();

  const deleteReport = async (report: TaskRecord) => {
    notify(`正在删除 ${report.name}`, { tone: 'info' });
    const isActiveReport = report.id === activeTask.id;
    const response = await workspaceFetch(
      `${apiBaseUrl}${isActiveReport ? '/api/tasks/active/report' : `/api/history/tasks/${encodeURIComponent(report.id)}`}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      notify('删除失败。', { tone: 'danger' });
      return;
    }
    if (isActiveReport) {
      setActiveTask(createEmptyTask());
      setContext(defaultWorkbenchContext);
    } else {
      setReports((current) => current.filter((item) => item.id !== report.id));
    }
    notify(`已彻底清除 ${report.name}。`, { tone: 'success' });
    if (!isActiveReport) loadReports();
  };

  const renderExports = (report: TaskRecord) => (
    <div className="actions-row">
      {(report.exports ?? []).map((item, index) =>
        item.artifactId ? (
          <button
            className="action-button secondary-button"
            key={`${item.artifactId}-${index}`}
            type="button"
            onClick={() => {
              void withTicketQuery(
                `${apiBaseUrl}/api/artifacts/${item.artifactId}/download`,
                apiBaseUrl,
                'download',
              ).then((url) => {
                window.location.href = url;
              });
            }}
          >
            {`下载 ${item.format}`}
          </button>
        ) : null,
      )}
      {(report.exports?.length ?? 0) === 0 ? (
        <span className="status-note">还没有导出文件。可在分析完成后导出。</span>
      ) : null}
    </div>
  );

  return (
    <div className="workspace-grid compact-page reports-page">
      <section className="enterprise-page-hero">
        <div className="enterprise-page-title-row">
          <div>
            <h3>看结果</h3>
            <p>先看本次结论，再下载报告；历史结果放在下面，方便回看。</p>
          </div>
          <div className="actions-row">
            <Link className="action-button secondary-button" to="/workspace?step=output">
              回到本次分析
            </Link>
            <Link className="action-button" to="/workspace?step=input">
              开始新分析
            </Link>
          </div>
        </div>
      </section>

      <section className="enterprise-metric-strip">
        <article className="enterprise-metric-card">
          <span>本次结果</span>
          <strong>{hasCurrent ? '已有数据' : '暂无'}</strong>
          <small>{hasCurrent ? activeTask.status : '完成分析后会出现'}</small>
        </article>
        <article className="enterprise-metric-card">
          <span>可下载文件</span>
          <strong>{exportCount}</strong>
          <small>PDF / Word / Markdown 等</small>
        </article>
        <article className="enterprise-metric-card">
          <span>历史结果</span>
          <strong>{historyReports.length}</strong>
          <small>过去保存的分析</small>
        </article>
        <article className="enterprise-metric-card">
          <span>当前状态</span>
          <strong>{status}</strong>
          <small>删除、导出后会即时反馈</small>
        </article>
      </section>

      {hasCurrent ? (
        <section className="content-card workspace-section workspace-conclusion-card" aria-label="本次结论">
          <div className="section-heading">
            <div>
              <h3>本次结论</h3>
              <p>{activeTask.name || '当前分析'} · {activeTask.status}</p>
            </div>
            <span className="history-badge">{activeTask.status}</span>
          </div>
          {conclusionText ? (
            <div className="workspace-conclusion-preview">{conclusionText}</div>
          ) : (
            <p className="status-note">还没有文字结论。可到工作台“查看结果”步骤补充摘要。</p>
          )}
          {activeTask.dataSource?.analysisScope ? (
            <p className="status-note">
              {`计算范围：${activeTask.dataSource.analysisScope.rowsProcessed}/${activeTask.dataSource.analysisScope.rowCount} 行`}
            </p>
          ) : null}
          <div className="section-heading" style={{ marginTop: 16 }}>
            <div>
              <h4>导出与下载</h4>
              <p>需要发给别人时，直接下载对应格式。</p>
            </div>
          </div>
          {renderExports(activeTask)}
          <div className="actions-row" style={{ marginTop: 12 }}>
            <Link className="action-button" to="/workspace?step=output">
              编辑结论 / 再导出
            </Link>
            <button className="action-button secondary-button" type="button" onClick={() => void deleteReport(activeTask)}>
              彻底删除
            </button>
            <button
              className="action-button tertiary-button"
              type="button"
              onClick={() => setStatus(`报告 ${activeTask.name} 已保存在任务历史中。`, 'info')}
            >
              查看状态
            </button>
          </div>
        </section>
      ) : null}

      <section className="content-card workspace-section">
        <div className="section-heading">
          <div>
            <h3>历史结果</h3>
            <p>过往分析与可下载文件。当前会话已在上方单独展示。</p>
          </div>
        </div>
        {loading ? (
          <PageSkeleton title="结果加载中" description="正在整理可阅读与可导出的结果…" cards={3} rows={3} compact />
        ) : null}
        <div className="history-list history-list-grid">
          {historyReports.map((report) => (
            <article className="history-card report-card" key={report.id}>
              <div className="history-card-header">
                <h4>{report.name}</h4>
                <span className="history-badge">{report.status}</span>
              </div>
              <p>{report.summary || '暂无摘要'}</p>
              {report.dataSource?.analysisScope ? (
                <p className="status-note">
                  {`计算范围：${report.dataSource.analysisScope.rowsProcessed}/${report.dataSource.analysisScope.rowCount} 行`}
                </p>
              ) : null}
              {renderExports(report)}
              <div className="actions-row">
                <button className="action-button secondary-button" type="button" onClick={() => void deleteReport(report)}>
                  彻底删除
                </button>
                <button
                  className="action-button tertiary-button"
                  type="button"
                  onClick={() => setStatus(`报告 ${report.name} 已保存在任务历史中。`, 'info')}
                >
                  查看状态
                </button>
              </div>
            </article>
          ))}
          {!loading && !hasCurrent && historyReports.length === 0 ? (
            <EmptyState
              icon="RC"
              title="还没有可查看的结果"
              description="先上传数据、完成一次分析，结论和导出文件会出现在这里。"
              primaryLabel="去做分析"
              primaryHref="/workspace?step=input"
              secondaryLabel="先上传数据"
              secondaryHref="/data-sources"
            />
          ) : null}
          {!loading && hasCurrent && historyReports.length === 0 ? (
            <p className="status-note">暂时没有更早的历史结果。完成并导出更多分析后会出现在这里。</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default ReportsPage;
