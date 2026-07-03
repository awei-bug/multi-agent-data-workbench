import { useState } from 'react';

type EditableDataGridProps = {
  onApply: (value: string) => void;
};

function EditableDataGrid({ onApply }: EditableDataGridProps) {
  const [value, setValue] = useState('2800');
  const [applied, setApplied] = useState(false);

  const handleApply = () => {
    setApplied(true);
    onApply(value);
  };

  return (
    <section className="content-card workspace-section">
      <div className="section-heading">
        <span className="section-index">06</span>
        <div>
          <h3>人工修正</h3>
          <p>允许业务人员直接修正清洗后的关键样例值，并触发下游节点重跑。</p>
        </div>
      </div>
      <label className="field-label" htmlFor="sample-sale">
        样例值 0-销售额
      </label>
      <input id="sample-sale" className="text-input" value={value} onChange={(event) => setValue(event.target.value)} />
      <div className="summary-grid summary-grid-strong">
        <div className="summary-card">
          <span>修正字段</span>
          <strong>销售额</strong>
        </div>
        <div className="summary-card">
          <span>影响范围</span>
          <strong>指标计算 / 图表 / 报告摘要</strong>
        </div>
      </div>
      <div className="actions-row">
        <button className="action-button" type="button" onClick={handleApply}>
          应用修改
        </button>
      </div>
      {applied ? <p className="status-note">已标记下游节点重跑。</p> : null}
    </section>
  );
}

export default EditableDataGrid;
