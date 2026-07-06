import { createMockTaskRepository } from '../mock/mockTaskRepository';
import { useNavigate } from 'react-router-dom';

const repository = createMockTaskRepository();

function DashboardPage() {
  const navigate = useNavigate();
  const activeTask = repository.getActiveTask();
  const recentTasks = repository.listRecentTasks();
  const finishedTasks = recentTasks.filter((task) => task.snapshot.phase === 'completed').length;
  const exportedCount = recentTasks.reduce((sum, task) => sum + task.exports.length, 0);
  const runningAgents = activeTask.snapshot.nodes.filter((node) => node.status === 'running').length;

  return (
    <div className="workspace-grid dashboard-page">
      <section className="content-card workspace-section dashboard-hero">
        <div className="section-heading">
          <span className="section-index">OV</span>
          <div>
            <h3>总览仪表盘</h3>
            <p>集中查看平台运行、Agent 状态、分析任务和异常提醒。</p>
          </div>
        </div>
        <div className="summary-grid summary-grid-strong">
          <div className="summary-card" title="当前可调度的清洗、计算、可视化、报告和审核 Agent">
            <span>在线 Agent</span>
            <strong>{activeTask.snapshot.nodes.length}</strong>
          </div>
          <div className="summary-card" title="今日创建和复用的分析任务总数">
            <span>今日分析任务</span>
            <strong>{recentTasks.length}</strong>
          </div>
          <div className="summary-card" title="已完成任务 / 今日分析任务">
            <span>任务完成率</span>
            <strong>{`${Math.round((finishedTasks / Math.max(recentTasks.length, 1)) * 100)}%`}</strong>
          </div>
          <div className="summary-card">
            <span>数据导出次数</span>
            <strong>{exportedCount}</strong>
          </div>
        </div>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">TR</span>
          <div>
            <h3>日任务量趋势</h3>
            <p>最近任务吞吐趋势，用于判断工作台使用热度。</p>
          </div>
        </div>
        <button className="plain-chart-button mini-chart-bars" aria-label="日任务量趋势图" type="button" onClick={() => navigate('/workflow-designer')}>
          {[42, 58, 36, 74, 66, 92, 80].map((height, index) => (
            <span key={height + index} style={{ height: `${height}%` }} />
          ))}
        </button>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">AG</span>
          <div>
            <h3>Agent 任务占比</h3>
            <p>按清洗、计算、可视化、报告和审核环节拆分。</p>
          </div>
        </div>
        <button className="plain-chart-button agent-donut" aria-label="Agent 任务占比图" type="button" onClick={() => navigate('/workflow-designer')}>
          <span>{runningAgents > 0 ? '运行中' : '空闲'}</span>
        </button>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">RT</span>
          <div>
            <h3>最近执行任务</h3>
            <p>展示近期分析任务状态、耗时和交付情况。</p>
          </div>
        </div>
        <div className="history-list">
          {recentTasks.map((task) => (
            <article className="history-card" key={task.id}>
              <div className="history-card-header">
                <h4>{task.name}</h4>
                <span className="history-badge">{task.status}</span>
              </div>
              <p>{task.summary}</p>
              <div className="actions-row">
                <button className="action-button secondary-button" type="button" onClick={() => navigate('/reports')}>
                  查看报告
                </button>
                <button className="action-button tertiary-button" type="button" onClick={() => navigate('/workspace')}>
                  进入工作台回放
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">AL</span>
          <div>
            <h3>异常与待复核</h3>
            <p>需要人工确认的数据口径、风险结论和导出事项。</p>
          </div>
        </div>
        <div className="context-block context-block-log-warn">
          <span className="context-label">当前提醒</span>
          <ul className="context-risk-list">
            {activeTask.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
          <div className="actions-row">
            <button className="action-button secondary-button" type="button" onClick={() => navigate('/chat-analysis')}>
              一键处理
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default DashboardPage;
