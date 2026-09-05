import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, LineChart, PieChart, RadarChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import type { EChartsOption } from 'echarts';
import { init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { TaskArtifactRecord, TaskDataSourceRecord } from '../../types/tasks';
import {
  aggregateComparisonRows,
  getAnalysisRows,
  getNumericFields,
  parseNumericValue,
  type ComparisonPoint,
} from '../../utils/dataAnalysis';

type ChartBoardProps = {
  dataSource?: TaskDataSourceRecord;
  metricArtifact?: TaskArtifactRecord;
  chartArtifact?: TaskArtifactRecord;
  onTitleChange: (title: string) => void;
};

type ChartType = 'bar' | 'pie' | 'line' | 'scatter' | 'radar';
type DocumentKeyword = { name: string; value: number };

let echartsRegistered = false;
function ensureEcharts() {
  if (echartsRegistered) return;
  use([
    BarChart,
    LineChart,
    PieChart,
    RadarChart,
    ScatterChart,
    CanvasRenderer,
    GridComponent,
    LegendComponent,
    RadarComponent,
    TitleComponent,
    TooltipComponent,
  ]);
  echartsRegistered = true;
}

function formatValue(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function normalize(value: number, max: number) {
  return max > 0 ? Number(((value / max) * 100).toFixed(2)) : 0;
}

function buildRankingOption(title: string, metric: string, points: ComparisonPoint[]): EChartsOption {
  const sorted = [...points].sort((left, right) => right.value - left.value).slice(0, 12).reverse();
  return {
    title: { text: title, left: 12, top: 8, textStyle: { fontSize: 15 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 120, right: 28, top: 58, bottom: 28 },
    xAxis: { type: 'value', name: metric },
    yAxis: { type: 'category', data: sorted.map((point) => point.name) },
    series: [{ type: 'bar', data: sorted.map((point) => point.value), itemStyle: { borderRadius: [0, 8, 8, 0] } }],
  };
}

function buildShareOption(metric: string, points: ComparisonPoint[]): EChartsOption {
  const sorted = [...points].sort((left, right) => right.value - left.value);
  const top = sorted.slice(0, 8);
  const other = sorted.slice(8).reduce((sum, point) => sum + point.value, 0);
  const data = other > 0 ? [...top, { name: '其他', value: other }] : top;
  return {
    title: { text: `${metric} 占比`, left: 12, top: 8, textStyle: { fontSize: 15 } },
    tooltip: { trigger: 'item' },
    legend: { type: 'scroll', bottom: 0 },
    series: [{ type: 'pie', radius: ['42%', '72%'], center: ['50%', '48%'], data }],
  };
}

function buildTrendOption(title: string, metric: string, points: ComparisonPoint[]): EChartsOption {
  return {
    title: { text: title, left: 12, top: 8, textStyle: { fontSize: 15 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 44, right: 28, top: 58, bottom: 28 },
    xAxis: { type: 'category', data: points.map((point) => point.name) },
    yAxis: { type: 'value', name: metric },
    series: [{ type: 'line', smooth: true, data: points.map((point) => point.value) }],
  };
}

function buildScatterOption(
  rows: ReturnType<typeof getAnalysisRows>,
  dimension: string,
  xMetric: string,
  yMetric: string,
): EChartsOption {
  const scatterRows = rows
    .map((row) => ({
      name: row[dimension] || '未命名',
      value: [parseNumericValue(row[xMetric]), parseNumericValue(row[yMetric])],
    }))
    .filter((item) => Number.isFinite(item.value[0]) && Number.isFinite(item.value[1]));

  return {
    title: { text: `${xMetric} / ${yMetric} 相关分布`, left: 12, top: 8, textStyle: { fontSize: 15 } },
    tooltip: {
      trigger: 'item',
      formatter: ((params: { name?: string; value?: unknown }) => {
        const value = Array.isArray(params.value) ? params.value : [0, 0];
        return `${params.name ?? '未命名'}<br/>${xMetric}: ${formatValue(Number(value[0] ?? 0))}<br/>${yMetric}: ${formatValue(Number(value[1] ?? 0))}`;
      }) as never,
    },
    grid: { left: 56, right: 28, top: 58, bottom: 48 },
    xAxis: { type: 'value', name: xMetric },
    yAxis: { type: 'value', name: yMetric },
    series: [{ type: 'scatter', symbolSize: 18, data: scatterRows }],
  };
}

function buildRadarOption(
  rows: ReturnType<typeof getAnalysisRows>,
  dimension: string,
  metrics: string[],
  baseMetric: string,
): EChartsOption {
  const rankedRows = [...rows]
    .map((row) => ({ row, value: parseNumericValue(row[baseMetric]) }))
    .filter((item) => Number.isFinite(item.value))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5);
  const maxByMetric = metrics.map((metric) =>
    Math.max(...rows.map((row) => parseNumericValue(row[metric])).filter(Number.isFinite), 0),
  );

  return {
    title: { text: '多指标能力对比', left: 12, top: 8, textStyle: { fontSize: 15 } },
    tooltip: {},
    legend: { bottom: 0 },
    radar: { radius: '62%', indicator: metrics.map((metric) => ({ name: metric, max: 100 })) },
    series: [
      {
        type: 'radar',
        data: rankedRows.map(({ row }) => ({
          name: row[dimension] || '未命名',
          value: metrics.map((metric, index) => normalize(parseNumericValue(row[metric]), maxByMetric[index])),
        })),
      },
    ],
  };
}

function buildDocumentKeywordOption(title: string, points: DocumentKeyword[]): EChartsOption {
  const sorted = [...points].sort((left, right) => right.value - left.value).slice(0, 12).reverse();
  return {
    title: { text: title, left: 12, top: 8, textStyle: { fontSize: 15 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 120, right: 28, top: 58, bottom: 28 },
    xAxis: { type: 'value', name: '出现次数' },
    yAxis: { type: 'category', data: sorted.map((point) => point.name) },
    series: [{ type: 'bar', data: sorted.map((point) => point.value), itemStyle: { borderRadius: [0, 8, 8, 0] } }],
  };
}

function buildDocumentEvidenceOption(points: DocumentKeyword[]): EChartsOption {
  const top = [...points].sort((left, right) => right.value - left.value).slice(0, 8);
  return {
    title: { text: '主题占比', left: 12, top: 8, textStyle: { fontSize: 15 } },
    tooltip: { trigger: 'item' },
    legend: { type: 'scroll', bottom: 0 },
    series: [{ type: 'pie', radius: ['42%', '72%'], center: ['50%', '48%'], data: top }],
  };
}

function ChartBoard({ dataSource, metricArtifact, chartArtifact, onTitleChange }: ChartBoardProps) {
  ensureEcharts();
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<ReturnType<typeof init> | null>(null);
  const [title, setTitle] = useState('核心指标排名');
  const rows = useMemo(() => getAnalysisRows(dataSource), [dataSource]);
  const fields = dataSource?.columns?.map((column) => column.name) ?? [];
  const numericFields = dataSource ? getNumericFields(dataSource, rows) : [];
  const [dimension, setDimension] = useState('');
  const [metric, setMetric] = useState('');
  const [secondaryMetric, setSecondaryMetric] = useState('');
  const [selectedChart, setSelectedChart] = useState<ChartType | null>(null);

  const serverGroups = Array.isArray(metricArtifact?.content?.groups)
    ? (metricArtifact?.content?.groups as Array<Record<string, unknown>>)
    : Array.isArray(chartArtifact?.content?.series)
      ? (chartArtifact?.content?.series as Array<Record<string, unknown>>)
      : [];
  const isDocumentMode =
    dataSource?.kind === 'document' ||
    String(metricArtifact?.content?.analysisMode ?? chartArtifact?.content?.analysisMode ?? '') === 'document';
  const serverPoints: ComparisonPoint[] = serverGroups
    .map((item) => ({ name: String(item.name ?? '未命名'), value: Number(item.value ?? 0) }))
    .filter((item) => Number.isFinite(item.value));

  useEffect(() => {
    const nextMetric = String(
      metricArtifact?.content?.metric ?? chartArtifact?.content?.metric ?? numericFields[0] ?? '',
    );
    const nextDimension = String(
      metricArtifact?.content?.dimension ??
        chartArtifact?.content?.dimension ??
        fields.find((field) => field !== nextMetric) ??
        fields[0] ??
        '',
    );
    const nextSecondaryMetric = numericFields.find((field) => field !== nextMetric) ?? nextMetric;
    setMetric(nextMetric);
    setDimension(nextDimension);
    setSecondaryMetric(nextSecondaryMetric);
    setSelectedChart(serverPoints.length > 0 || isDocumentMode || numericFields.length > 0 ? 'bar' : null);
    if (chartArtifact?.content?.title) setTitle(String(chartArtifact.content.title));
  }, [dataSource?.fileName, metricArtifact, chartArtifact]);

  const localPoints = dimension && metric ? aggregateComparisonRows(rows, dimension, metric) : [];
  const points = serverPoints.length > 0 ? serverPoints : localPoints;
  const rankedPoints = useMemo(() => [...points].sort((left, right) => right.value - left.value), [points]);
  const radarMetrics = numericFields.slice(0, 5);
  const top = rankedPoints[0];
  const bottom = rankedPoints[rankedPoints.length - 1];
  const total = rankedPoints.reduce((sum, point) => sum + point.value, 0);
  const topThreeShare = total ? rankedPoints.slice(0, 3).reduce((sum, point) => sum + point.value, 0) / total : 0;

  const chartOptions: Array<{ type: ChartType; label: string; description: string; disabled?: boolean }> = isDocumentMode
    ? [
        { type: 'bar', label: '主题词频图', description: '看文档主题词出现频次' },
        { type: 'pie', label: '主题占比图', description: '看主题词占比' },
      ]
    : [
        { type: 'bar', label: '排名柱状图', description: '看分类排名和差距' },
        { type: 'pie', label: '占比环图', description: '看各分类贡献占比' },
        { type: 'line', label: '趋势折线图', description: '看分类顺序上的变化' },
        { type: 'scatter', label: '散点图', description: '看两个数值指标的关系', disabled: numericFields.length < 2 },
        { type: 'radar', label: '雷达图', description: '看多指标能力对比', disabled: radarMetrics.length < 2 },
      ];

  const handleTitleChange = (value: string) => {
    setTitle(value);
    onTitleChange(value);
  };

  useEffect(() => {
    if (!chartRef.current || points.length === 0 || !selectedChart) return;

    const host = chartRef.current;
    if (host.clientWidth < 8 || host.clientHeight < 8) {
      host.style.width = '100%';
      host.style.height = selectedChart === 'bar' ? '460px' : '360px';
    }

    const chart = chartInstanceRef.current ?? init(host);
    chartInstanceRef.current = chart;
    const option =
      isDocumentMode && selectedChart === 'bar'
        ? buildDocumentKeywordOption(title || '文档主题词频', rankedPoints)
        : isDocumentMode && selectedChart === 'pie'
          ? buildDocumentEvidenceOption(rankedPoints)
          : selectedChart === 'bar'
            ? buildRankingOption(title, metric, rankedPoints)
            : selectedChart === 'pie'
              ? buildShareOption(metric, rankedPoints)
              : selectedChart === 'line'
                ? buildTrendOption(title, metric, points)
                : selectedChart === 'scatter'
                  ? buildScatterOption(rows, dimension, metric, secondaryMetric)
                  : buildRadarOption(rows, dimension, radarMetrics, metric);

    chart.setOption(option, true);
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    const raf = window.requestAnimationFrame(() => chart.resize());
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [
    dimension,
    metric,
    points,
    radarMetrics.join('|'),
    rankedPoints,
    rows,
    secondaryMetric,
    selectedChart,
    title,
    isDocumentMode,
  ]);

  useEffect(
    () => () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    },
    [],
  );

  if (
    !dataSource ||
    (!isDocumentMode && (rows.length === 0 || numericFields.length === 0)) ||
    (isDocumentMode && rankedPoints.length === 0)
  ) {
    return (
      <div className="chart-board-inline">
        <p className="status-note">
          {isDocumentMode ? '请先执行文档分析流程。' : '当前数据源还没有可用于汇总的有效数值数据。'}
        </p>
      </div>
    );
  }

  return (
    <div className="chart-board-inline">
      <div className="chart-command-board">
        <div className="summary-grid">
          <label className="field-label">
            分类字段
            <select className="text-input" value={dimension} onChange={(event) => setDimension(event.target.value)}>
              {fields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            数值字段
            <select className="text-input" value={metric} onChange={(event) => setMetric(event.target.value)}>
              {numericFields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            对比字段
            <select
              className="text-input"
              value={secondaryMetric}
              onChange={(event) => setSecondaryMetric(event.target.value)}
              disabled={numericFields.length < 2}
            >
              {numericFields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field-label" htmlFor="chart-title">
          图表标题
        </label>
        <input
          id="chart-title"
          className="text-input"
          value={title}
          onChange={(event) => handleTitleChange(event.target.value)}
        />
      </div>

      <div className="summary-grid summary-grid-strong chart-insight-grid">
        <div className="summary-card">
          <span>领先项</span>
          <strong>{top ? `${top.name} / ${formatValue(top.value)}` : '无'}</strong>
        </div>
        <div className="summary-card">
          <span>首尾差距</span>
          <strong>{top && bottom ? formatValue(top.value - bottom.value) : '无'}</strong>
        </div>
        <div className="summary-card">
          <span>前三集中度</span>
          <strong>{`${(topThreeShare * 100).toFixed(1)}%`}</strong>
        </div>
        <div className="summary-card">
          <span>可比较指标</span>
          <strong>{numericFields.length}</strong>
        </div>
      </div>

      <div className="chart-type-grid">
        {chartOptions.map((option) => (
          <button
            key={option.type}
            className={`summary-card chart-type-button${selectedChart === option.type ? ' active-tab-card' : ''}`}
            type="button"
            disabled={option.disabled}
            onClick={() => setSelectedChart(option.type)}
          >
            <span>{option.label}</span>
            <strong>{option.disabled ? '当前数据条件不足' : option.description}</strong>
          </button>
        ))}
      </div>

      {!selectedChart ? <p className="status-note">先选择图表类型，再查看结果。</p> : null}

      {selectedChart ? (
        <div className="chart-preview chart-preview-strong">
          <div
            ref={chartRef}
            className={`chart-canvas${selectedChart === 'bar' ? ' chart-canvas-large' : ''}`}
            aria-label="数据分析图表"
          />
          <div className="chart-preview-footer">
            <span>{`图表：${chartOptions.find((option) => option.type === selectedChart)?.label ?? ''}`}</span>
            <span>{`分类：${dimension}`}</span>
            <span>{`汇总：${metric}`}</span>
            {selectedChart === 'scatter' ? <span>{`对比：${secondaryMetric}`}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ChartBoard;
