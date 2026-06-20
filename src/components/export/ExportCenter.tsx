import type { ExportRecord } from '../../types/tasks';

type ExportCenterProps = {
  status: string;
  onExport: (record: ExportRecord) => void;
  onSaveTemplate?: () => void;
};

function ExportCenter({ status, onExport, onSaveTemplate }: ExportCenterProps) {
  return (
    <section className="content-card workspace-section">
      <div className="section-heading">
        <span className="section-index">09</span>
        <div>
          <h3>导出中心</h3>
          <p>在交付前统一处理高频导出动作和模板沉淀。</p>
        </div>
      </div>
      <div className="history-detail-block">
        <h4>快速交付</h4>
        <p>如果已在“报告编辑”中完成内容校对，这里用于再次触发导出或沉淀模板。</p>
      </div>
      <div className="actions-row">
        <button className="action-button" type="button" onClick={() => onExport({ format: 'PDF', status: 'PDF 导出完成' })}>
          导出 PDF
        </button>
        <button className="action-button secondary-button" type="button" onClick={() => onExport({ format: 'Word', status: 'Word 导出完成' })}>
          导出 Word
        </button>
        <button
          className="action-button secondary-button"
          type="button"
          onClick={() => onExport({ format: 'Markdown', status: 'Markdown 导出完成' })}
        >
          导出 Markdown
        </button>
        <button className="action-button secondary-button" type="button" onClick={onSaveTemplate}>
          保存为模板
        </button>
      </div>
      <div className="log-card context-block-log-success">
        <strong>最新导出状态</strong>
        <p>{status}</p>
      </div>
    </section>
  );
}

export default ExportCenter;
