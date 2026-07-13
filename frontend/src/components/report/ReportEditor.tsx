import type { ExportRecord } from '../../types/tasks';

type ReportEditorProps = {
  summary: string;
  onSummaryChange: (summary: string) => void;
  onExport?: (record: ExportRecord) => void;
  onSaveTemplate?: () => void;
};

function ReportEditor({ summary, onSummaryChange, onExport, onSaveTemplate }: ReportEditorProps) {
  return (
    <section className="content-card workspace-section" id="report-editor">
      <div className="section-heading">
        <span className="section-index">08</span>
        <div>
          <h3>报告编辑</h3>
          <p>把分析结果收口成可交付文本，并在这里直接完成导出。</p>
        </div>
      </div>

      <div className="report-editor-toolbar">
        <div className="report-editor-meta">
          <span>当前交付内容</span>
          <strong>执行摘要与结论说明</strong>
          <small>建议在导出前确认图表标题、风险提示和业务口径一致。</small>
        </div>
        <div className="enterprise-page-actions">
          <button className="action-button" type="button" onClick={() => onExport?.({ format: 'PDF', status: 'PDF 导出完成' })}>
            导出 PDF
          </button>
          <button className="action-button secondary-button" type="button" onClick={() => onExport?.({ format: 'Word', status: 'Word 导出完成' })}>
            导出 Word
          </button>
          <button className="action-button secondary-button" type="button" onClick={() => onExport?.({ format: 'Markdown', status: 'Markdown 导出完成' })}>
            导出 Markdown
          </button>
        </div>
      </div>

      <label className="field-label" htmlFor="report-summary">
        执行摘要
      </label>
      <textarea
        id="report-summary"
        className="text-input text-area"
        value={summary}
        onChange={(event) => onSummaryChange(event.target.value)}
      />

      <div className="history-detail-block report-helper-card">
        <h4>交付前检查</h4>
        <p>确认摘要口径、图表标题、风险说明和建议动作是否与当前分析结论一致。</p>
      </div>

      <div className="actions-row">
        <button className="action-button secondary-button" type="button" onClick={onSaveTemplate}>
          保存为模板
        </button>
      </div>
    </section>
  );
}

export default ReportEditor;
