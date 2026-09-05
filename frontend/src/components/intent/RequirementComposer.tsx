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
  readOnly?: boolean;
};

function RequirementComposer({
  initialValue,
  defaultMetrics = '同比、环比、区域对比',
  defaultDimensions = '月份、区域、渠道',
  onDraftChange,
  onParse,
  readOnly = false,
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
    <section className="content-card workspace-section" id="requirement-composer">
      <div className="section-heading">
          <div>
          <h3>说明你想分析什么</h3>
          <p>用一句话说清楚就行，不用写公式或专业术语。系统会自动整理成分析方案。</p>
        </div>
      </div>
      <label className="field-label" htmlFor="analysis-request">
        你的分析问题
      </label>
      <textarea
        id="analysis-request"
        className="text-input text-area"
        value={value}
        placeholder="例如：比较各区域销售额，并找出异常月份"
        onChange={(event) => handleChange(event.target.value)}
        disabled={readOnly}
      />
      <div className="actions-row">
        <button className="action-button" type="button" onClick={handleParse} disabled={readOnly}>
          生成分析方案
        </button>
        <button className="action-button secondary-button" type="button" onClick={() => setShowExample((current) => !current)}>
          {showExample ? '收起示例' : '看看怎么写'}
        </button>
      </div>
      {readOnly ? <p className="status-note">当前为只读，无法修改问题。</p> : null}
      {showExample ? (
        <div className="preview-card example-card">
          <h4>写法示例</h4>
          <div className="example-grid">
            <div>
              <span className="context-label">你可以这样写</span>
              <p>分析 2025 年月度销售趋势，找出区域差异，并输出管理层报告。</p>
            </div>
            <div>
              <span className="context-label">系统会帮你整理成</span>
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
