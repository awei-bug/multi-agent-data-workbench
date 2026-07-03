import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

type ChartBoardProps = {
  onTitleChange: (title: string) => void;
};

const chartTypes = ['折线图', '柱状图', '面积图', '饼图', '环形图', '散点图', '雷达图', '热力图'] as const;
type ChartType = (typeof chartTypes)[number];

const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const regions = ['华东', '华北', '华南'];
const salesByRegion = {
  华东: [382, 426, 458, 492, 531, 568, 568, 584, 596, 612, 629, 654],
  华北: [318, 336, 352, 374, 389, 421, 421, 438, 447, 455, 463, 482],
  华南: [286, 309, 342, 361, 394, 438, 452, 466, 486, 521, 548, 596],
};

function buildChartOption(title: string, chartType: ChartType): EChartsOption {
  const totalByRegion = regions.map((region) => ({
    name: region,
    value: salesByRegion[region as keyof typeof salesByRegion].reduce((sum, value) => sum + value, 0),
  }));

  if (chartType === '饼图' || chartType === '环形图') {
    return {
      title: { text: title, left: 12, top: 8, textStyle: { fontSize: 15 } },
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: chartType === '环形图' ? ['42%', '68%'] : '68%',
          center: ['50%', '50%'],
          data: totalByRegion,
        },
      ],
    };
  }

  if (chartType === '散点图') {
    return {
      title: { text: title, left: 12, top: 8, textStyle: { fontSize: 15 } },
      tooltip: { trigger: 'item' },
      grid: { left: 44, right: 24, top: 56, bottom: 54 },
      xAxis: { type: 'category', data: months },
      yAxis: { type: 'value' },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18 }],
      series: regions.map((region) => ({
        name: region,
        type: 'scatter',
        symbolSize: 12,
        data: salesByRegion[region as keyof typeof salesByRegion],
      })),
    };
  }

  if (chartType === '雷达图') {
    return {
      title: { text: title, left: 12, top: 8, textStyle: { fontSize: 15 } },
      tooltip: {},
      legend: { bottom: 0 },
      radar: {
        radius: '58%',
        indicator: months.map((month) => ({ name: month, max: 700 })),
      },
      series: [
        {
          type: 'radar',
          data: regions.map((region) => ({
            name: region,
            value: salesByRegion[region as keyof typeof salesByRegion],
          })),
        },
      ],
    };
  }

  if (chartType === '热力图') {
    return {
      title: { text: title, left: 12, top: 8, textStyle: { fontSize: 15 } },
      tooltip: { position: 'top' },
      grid: { left: 52, right: 24, top: 56, bottom: 42 },
      xAxis: { type: 'category', data: months },
      yAxis: { type: 'category', data: regions },
      visualMap: { min: 280, max: 700, orient: 'horizontal', left: 'center', bottom: 0 },
      series: [
        {
          type: 'heatmap',
          data: regions.flatMap((region, regionIndex) =>
            salesByRegion[region as keyof typeof salesByRegion].map((value, monthIndex) => [monthIndex, regionIndex, value]),
          ),
        },
      ],
    };
  }

  const lineType = chartType === '柱状图' ? 'bar' : 'line';
  return {
    title: { text: title, left: 12, top: 8, textStyle: { fontSize: 15 } },
    tooltip: { trigger: 'axis' },
    legend: { top: 30 },
    grid: { left: 44, right: 24, top: 72, bottom: 54 },
    xAxis: { type: 'category', data: months },
    yAxis: { type: 'value' },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18 }],
    series: regions.map((region) => ({
      name: region,
      type: lineType,
      smooth: chartType !== '柱状图',
      areaStyle: chartType === '面积图' ? {} : undefined,
      data: salesByRegion[region as keyof typeof salesByRegion],
    })),
  };
}

function ChartBoard({ onTitleChange }: ChartBoardProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [title, setTitle] = useState('销售趋势总览');
  const [chartType, setChartType] = useState<ChartType>('折线图');

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    const chart = echarts.init(chartRef.current);
    chart.setOption(buildChartOption(title, chartType));
    const resize = () => chart.resize();

    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [chartType, title]);

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
        {chartTypes.map((type) => (
          <button
            className={`action-button ${chartType === type ? '' : 'secondary-button'}`}
            type="button"
            key={type}
            onClick={() => setChartType(type)}
          >
            {type}
          </button>
        ))}
      </div>
      <div className="summary-grid chart-toolbar-grid">
        <div className="summary-card">
          <span>当前图表</span>
          <strong>{chartType}</strong>
        </div>
        <div className="summary-card">
          <span>交互能力</span>
          <strong>悬停详情 / 缩放 / 类型切换</strong>
        </div>
      </div>
      <div className="chart-preview chart-preview-strong">
        <div ref={chartRef} className="chart-canvas" aria-label={`${chartType}预览`} />
        <div className="chart-preview-footer">
          <span>示例数据点：2025-01 华东 3,820</span>
          <span>缩放范围：近 12 个月</span>
        </div>
      </div>
    </section>
  );
}

export default ChartBoard;
