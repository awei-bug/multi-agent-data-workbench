import { useEffect, useState } from 'react';

type RequirementComposerProps = {
  initialValue: string;
  defaultMetrics?: string;
  defaultDimensions?: string;
  onDraftChange?: (value: string) => void;
  onParse: (payload: {
    request: string;
    goal: string;
    metrics: string;
    dimensions: string;
    charts: string;
  }) => void;
};

function RequirementComposer({
  initialValue,
  defaultMetrics = '同比、环比、区域对比',
  defaultDimensions = '月份、区域、渠道',
  onDraftChange,
  onParse,
}: RequirementComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [showExample, setShowExample] = useState(false);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleChange = (nextValue: string) => {
    setValue(nextValue);
    onDraftChange?.(nextValue);
  };

  const handleParse = () => {
    onParse({
      request: value,
      goal: '月度销售趋势分析',
      metrics: defaultMetrics,
      dimensions: defaultDimensions,
      charts: '折线图、分组柱状图、区域排名条形图',
    });
  };

  return (
    <section className="content-card workspace-section">
      <div className="section-heading">
        <span className="section-index">02</span>
        <div>
          <h3>需求输入</h3>
          <p>用自然语言描述分析目标，由系统自动整理为结构化意图。</p>
        </div>
      </div>
      <label className="field-label" htmlFor="analysis-request">
        分析需求
      </label>
      <textarea
        id="analysis-request"
        className="text-input text-area"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
      />
      <div className="actions-row">
        <button className="action-button" type="button" onClick={handleParse}>
          解析意图
        </button>
        <button className="action-button secondary-button" type="button" onClick={() => setShowExample((current) => !current)}>
          解析示例
        </button>
      </div>
      {showExample ? (
        <div className="preview-card example-card">
          <h4>自然语言到结构化意图示例</h4>
          <div className="example-grid">
            <div>
              <span className="context-label">输入描述</span>
              <p>分析 2025 年月度销售趋势，找出区域差异，并输出管理层报告。</p>
            </div>
            <div>
              <span className="context-label">系统解析</span>
              <p>目标：月度销售趋势分析</p>
              <p>指标：销售额、同比、环比</p>
              <p>维度：月份、区域</p>
              <p>图表：折线图、区域对比柱状图</p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default RequirementComposer;
