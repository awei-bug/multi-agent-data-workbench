import { useState } from 'react';

type ChartBoardProps = {
  onTitleChange: (title: string) => void;
};

function ChartBoard({ onTitleChange }: ChartBoardProps) {
  const [title, setTitle] = useState('销售趋势总览');
  const [chartType, setChartType] = useState<'折线图' | '柱状图' | '面积图'>('折线图');

  const handleChange = (value: string) => {
    setTitle(value);
    onTitleChange(value);
  };

  return (
    <section className="content-card workspace-section">
      <div className="section-heading">
        <span className="section-index">07</span>
        <div>
          <h3>可视化看板</h3>
          <p>切换基础图表形态，保留标题、悬停和缩放入口，先把可用性搭起来。</p>
        </div>
      </div>
      <label className="field-label" htmlFor="chart-title">
        图表标题
      </label>
      <input id="chart-title" className="text-input" value={title} onChange={(event) => handleChange(event.target.value)} />
      <div className="actions-row">
        <button className="action-button secondary-button" type="button" onClick={() => setChartType('折线图')}>
          折线图
        </button>
        <button className="action-button secondary-button" type="button" onClick={() => setChartType('柱状图')}>
          柱状图
        </button>
        <button className="action-button secondary-button" type="button" onClick={() => setChartType('面积图')}>
          面积图
        </button>
      </div>
      <div className="chart-preview">
        <strong>{title}</strong>
        <p>{`${chartType} / 支持悬停详情 / 支持缩放`}</p>
      </div>
    </section>
  );
}

export default ChartBoard;
