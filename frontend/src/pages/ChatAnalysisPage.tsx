import { useEffect, useState } from 'react';

import ChartBoard from '../components/charts/LazyChartBoard';
import EmptyState from '../components/feedback/EmptyState';
import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import { aggregateComparisonRows, getAnalysisRows, getNumericFields } from '../utils/dataAnalysis';
import { workspaceFetch } from '../utils/workspaceIdentity';

function formatValue(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function ChatAnalysisPage() {
  const { activeTask, setActiveTask, setContext } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const dataSource = activeTask.dataSource;
  const rows = getAnalysisRows(dataSource);
  const fields = dataSource?.columns?.map((column) => column.name) ?? [];
  const numericFields = dataSource ? getNumericFields(dataSource, rows) : [];
  const metricArtifact = [...(activeTask.artifacts ?? [])].reverse().find((item) => item.type === 'metric_result');
  const analysisArtifact = [...(activeTask.artifacts ?? [])].reverse().find((item) => item.type === 'analysis');
  const chartArtifact = [...(activeTask.artifacts ?? [])].reverse().find((item) => item.type === 'chart_spec');
  const isDocumentMode =
    dataSource?.kind === 'document'
    || String(metricArtifact?.content?.analysisMode ?? analysisArtifact?.content?.analysisMode ?? '') === 'document';

  const [dimension, setDimension] = useState('');
  const [metric, setMetric] = useState('');

  useEffect(() => {
    let cancelled = false;
    void workspaceFetch(`${apiBaseUrl}/api/tasks/active`)
      .then((response) => (response.ok ? response.json() : null))
      .then((task) => {
        if (cancelled || !task) return;
        setActiveTask((current) => ({
          ...current,
          ...task,
          dataSource: task.dataSource ?? current.dataSource,
          artifacts: task.artifacts ?? current.artifacts,
          exports: task.exports ?? current.exports,
          risks: task.risks ?? current.risks,
          executionLog: task.executionLog ?? current.executionLog,
          intent: task.intent ?? current.intent,
          snapshot: task.snapshot ?? current.snapshot,
          execution: task.execution ? { ...(current.execution || {}), ...task.execution } : current.execution,
        }));
        if (task.snapshot?.context) setContext(task.snapshot.context);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, setActiveTask, setContext]);

  useEffect(() => {
    const nextMetric = String(metricArtifact?.content?.metric ?? numericFields[0] ?? '');
    const nextDimension = String(
      metricArtifact?.content?.dimension
        ?? fields.find((field) => field !== nextMetric)
        ?? fields[0]
        ?? '',
    );
    setMetric(nextMetric);
    setDimension(nextDimension);
  }, [
    dataSource?.fileName,
    metricArtifact?.content?.metric,
    metricArtifact?.content?.dimension,
    fields.join('|'),
    numericFields.join('|'),
  ]);

  const points = dimension && metric
    ? aggregateComparisonRows(rows, dimension, metric).sort((left, right) => right.value - left.value)
    : [];

  const total = points.reduce((sum, point) => sum + point.value, 0);
  const average = points.length ? total / points.length : 0;
  const highest = points[0];
  const lowest = points[points.length - 1];

  if (!dataSource) {
    return (
      <div className="workspace-grid compact-page">
        <section className="enterprise-page-hero">
          <span className="enterprise-page-kicker">图表与结论 / 分析中枢</span>
          <div className="enterprise-page-title-row">
            <div>
              <h3>分析结果总览</h3>
              <p>这里集中展示当前任务的图表与结论、文档结论和图表预览。先在工作台上传数据并启动流程，系统才会生成可视化结果。</p>
            </div>
          </div>
        </section>

        <section className="enterprise-metric-strip">
          <article className="enterprise-metric-card">
            <span>当前状态</span>
            <strong>等待数据源</strong>
            <small>尚未加载分析文件</small>
          </article>
          <article className="enterprise-metric-card">
            <span>分析模式</span>
            <strong>未识别</strong>
            <small>表格分析或文档分析</small>
          </article>
          <article className="enterprise-metric-card">
            <span>可用图表</span>
            <strong>0</strong>
            <small>需先生成图表规格</small>
          </article>
          <article className="enterprise-metric-card">
            <span>输出结果</span>
            <strong>待生成</strong>
            <small>等待工作流执行</small>
          </article>
        </section>

        <section className="content-card workspace-section">
          <EmptyState
            icon="IA"
            title="还没有可洞察的数据"
            description="先绑定数据源并启动工作流，这里会集中展示指标、图表和结论。"
            primaryLabel="去接入数据源"
            primaryHref="/data-sources"
            secondaryLabel="进入工作台"
            secondaryHref="/workspace?step=input"
          />
        </section>
      </div>
    );
  }

  if (isDocumentMode) {
    const evidence =
      ((analysisArtifact?.content?.evidence as { evidence?: Array<{ text: string; score: number }>; keywords?: Array<{ term: string; count: number }> } | undefined)?.evidence
      ?? []);
    const keywords = ((analysisArtifact?.content?.evidence as { keywords?: Array<{ term: string; count: number }> } | undefined)?.keywords ?? []);

    return (
      <div className="workspace-grid compact-page">
        <section className="enterprise-page-hero">
          <span className="enterprise-page-kicker">文档洞察 / 语义分析</span>
          <div className="enterprise-page-title-row">
            <div>
              <h3>文档分析结果台</h3>
              <p>{`基于 ${dataSource.fileName} 的文本内容输出摘要、关键词分布和关键证据，适合方案、纪要、报告、访谈等非结构化内容分析。`}</p>
            </div>
          </div>
        </section>

        <section className="enterprise-metric-strip">
          <article className="enterprise-metric-card">
            <span>字符数</span>
            <strong>{dataSource.profile?.charCount ?? 0}</strong>
            <small>文档文本规模</small>
          </article>
          <article className="enterprise-metric-card">
            <span>段落数</span>
            <strong>{dataSource.profile?.paragraphCount ?? dataSource.rowCount}</strong>
            <small>结构切分结果</small>
          </article>
          <article className="enterprise-metric-card">
            <span>关键词数</span>
            <strong>{keywords.length}</strong>
            <small>已提取高频主题</small>
          </article>
          <article className="enterprise-metric-card">
            <span>证据片段</span>
            <strong>{evidence.length}</strong>
            <small>可追溯文本依据</small>
          </article>
        </section>

        <ChartBoard
          dataSource={dataSource}
          metricArtifact={metricArtifact}
          chartArtifact={undefined}
          onTitleChange={() => undefined}
        />

        <section className="content-card workspace-section">
          <div className="section-heading">
            <span className="section-index">IA</span>
            <div>
              <h3>文档洞察</h3>
              <p>系统会将自然语言分析结果与可追溯证据绑定，便于直接进入报告编辑和审核。</p>
            </div>
          </div>
          <p className="status-note">{String(analysisArtifact?.content?.summary ?? '请先在工作台执行文档分析流程。')}</p>
        </section>

        <section className="content-card workspace-section">
          <div className="section-heading">
            <span className="section-index">KW</span>
            <div>
              <h3>高频主题词</h3>
              <p>按文档中出现频次提取的核心主题，帮助快速锁定讨论重点。</p>
            </div>
          </div>
          {keywords.length > 0 ? (
            <ul className="context-risk-list">
              {keywords.map((item) => <li key={item.term}>{`${item.term}：${item.count}`}</li>)}
            </ul>
          ) : (
            <p className="status-note">暂未识别到关键词，请先完成文档分析。</p>
          )}
        </section>

        <section className="content-card workspace-section">
          <div className="section-heading">
            <span className="section-index">EV</span>
            <div>
              <h3>关键证据</h3>
              <p>展示与分析结论最相关的原文片段，确保报告可追溯。</p>
            </div>
          </div>
          {evidence.length > 0 ? (
            <ol className="context-risk-list">
              {evidence.map((item, index) => <li key={`${index}-${item.text}`}>{item.text}</li>)}
            </ol>
          ) : (
            <p className="status-note">暂无可展示证据，请先运行文档分析流程。</p>
          )}
        </section>
      </div>
    );
  }

  if (rows.length === 0 || numericFields.length === 0) {
    return (
      <div className="workspace-grid compact-page">
        <section className="enterprise-page-hero">
          <span className="enterprise-page-kicker">表格洞察 / 数值分析</span>
          <div className="enterprise-page-title-row">
            <div>
              <h3>数据分析结果台</h3>
              <p>当前已接入文件，但还缺少足够的结构化数值字段，系统无法生成有效统计结果。</p>
            </div>
          </div>
        </section>

        <section className="enterprise-metric-strip">
          <article className="enterprise-metric-card">
            <span>数据文件</span>
            <strong>{dataSource.fileName}</strong>
            <small>{`${dataSource.rowCount} 行记录`}</small>
          </article>
          <article className="enterprise-metric-card">
            <span>字段数</span>
            <strong>{fields.length}</strong>
            <small>结构化字段总量</small>
          </article>
          <article className="enterprise-metric-card">
            <span>数值字段</span>
            <strong>{numericFields.length}</strong>
            <small>不足以支撑统计分析</small>
          </article>
          <article className="enterprise-metric-card">
            <span>当前状态</span>
            <strong>待补充字段</strong>
            <small>建议上传包含数值列的数据</small>
          </article>
        </section>

        <section className="content-card workspace-section">
          <div className="section-heading">
            <span className="section-index">IA</span>
            <div>
              <h3>图表与结论</h3>
              <p>系统需要至少一个可聚合数值字段，才能生成排行、图表和统计结论。</p>
            </div>
          </div>
          <p className="status-note">当前数据源缺少可用于统计分析的有效数值字段。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="workspace-grid compact-page">
      <section className="enterprise-page-hero">
        <span className="enterprise-page-kicker">图表与结论 / 图表与排行</span>
        <div className="enterprise-page-title-row">
          <div>
            <h3>结构化数据分析结果台</h3>
            <p>{`基于 ${dataSource.fileName} 的 ${rows.length} 条有效记录生成分组汇总、图表预览和趋势结论，支持直接切换统计维度与指标。`}</p>
          </div>
        </div>
      </section>

      <section className="enterprise-metric-strip">
        <article className="enterprise-metric-card">
          <span>汇总总值</span>
          <strong>{formatValue(total)}</strong>
          <small>{metric || '等待选择指标'}</small>
        </article>
        <article className="enterprise-metric-card">
          <span>分组平均</span>
          <strong>{formatValue(average)}</strong>
          <small>{dimension || '等待选择维度'}</small>
        </article>
        <article className="enterprise-metric-card">
          <span>最高分组</span>
          <strong>{highest ? highest.name : '暂无'}</strong>
          <small>{highest ? formatValue(highest.value) : '无可用结果'}</small>
        </article>
        <article className="enterprise-metric-card">
          <span>最低分组</span>
          <strong>{lowest ? lowest.name : '暂无'}</strong>
          <small>{lowest ? formatValue(lowest.value) : '无可用结果'}</small>
        </article>
      </section>

      <ChartBoard
        dataSource={dataSource}
        metricArtifact={metricArtifact}
        chartArtifact={chartArtifact}
        onTitleChange={() => undefined}
      />

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">CT</span>
          <div>
            <h3>分析控制台</h3>
            <p>切换比较维度和汇总指标，图表与排行会同步更新。</p>
          </div>
        </div>
        <div className="summary-grid">
          <label className="field-label">
            比较维度
            <select className="text-input" value={dimension} onChange={(event) => setDimension(event.target.value)}>
              {fields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            汇总指标
            <select className="text-input" value={metric} onChange={(event) => setMetric(event.target.value)}>
              {numericFields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
        </div>
        {highest && lowest ? (
          <p className="status-note">{`${highest.name} 相比 ${lowest.name} 高 ${formatValue(highest.value - lowest.value)}。`}</p>
        ) : null}
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">RK</span>
          <div>
            <h3>分组排行</h3>
            <p>{`按 ${dimension} 汇总 ${metric}，结果按数值从高到低排序。`}</p>
          </div>
        </div>
        <table className="preview-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>{dimension}</th>
              <th>{metric}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={point.name}>
                <td>{index + 1}</td>
                <td>{point.name}</td>
                <td>{formatValue(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default ChatAnalysisPage;
