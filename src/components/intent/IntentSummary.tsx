type IntentSummaryProps = {
  summary: {
    request: string;
    goal: string;
    metrics: string;
    dimensions: string;
    charts: string;
  } | null;
};

function IntentSummary({ summary }: IntentSummaryProps) {
  return (
    <section className="content-card workspace-section">
      <div className="section-heading">
        <span className="section-index">03</span>
        <div>
          <h3>意图摘要</h3>
          <p>将自然语言任务拆解为目标、关键指标、分析维度和推荐图表。</p>
        </div>
      </div>
      {summary ? (
        <div className="summary-grid">
          <div className="summary-card">
            <span>目标</span>
            <strong>{summary.goal}</strong>
          </div>
          <div className="summary-card">
            <span>指标</span>
            <strong>{summary.metrics}</strong>
          </div>
          <div className="summary-card">
            <span>维度</span>
            <strong>{summary.dimensions}</strong>
          </div>
          <div className="summary-card">
            <span>图表</span>
            <strong>{summary.charts}</strong>
          </div>
        </div>
      ) : (
        <p className="empty-state">输入分析需求后，这里会显示结构化意图摘要。</p>
      )}
    </section>
  );
}

export default IntentSummary;
