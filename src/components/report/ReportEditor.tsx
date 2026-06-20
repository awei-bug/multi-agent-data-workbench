import type { ExportRecord } from '../../types/tasks';

type ReportEditorProps = {
  summary: string;
  onSummaryChange: (summary: string) => void;
  onExport?: (record: ExportRecord) => void;
  onSaveTemplate?: () => void;
};

function ReportEditor({ summary, onSummaryChange, onExport, onSaveTemplate }: ReportEditorProps) {
  return (
    <section className="content-card workspace-section">
      <div className="section-heading">
        <span className="section-index">08</span>
        <div>
          <h3>报告编辑</h3>
          <p>对系统生成的报告草稿补充业务背景、结论和对外表达。</p>
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
      <div className="actions-row">
        <button className="action-button" type="button" onClick={() => onExport?.({ format: 'PDF', status: 'PDF 导出完成' })}>
          导出 PDF
        </button>
        <button
          className="action-button secondary-button"
          type="button"
          onClick={() => onExport?.({ format: 'Word', status: 'Word 导出完成' })}
        >
          导出 Word
        </button>
        <button
          className="action-button secondary-button"
          type="button"
          onClick={() => onExport?.({ format: 'Markdown', status: 'Markdown 导出完成' })}
        >
          导出 Markdown
        </button>
        <button className="action-button secondary-button" type="button" onClick={onSaveTemplate}>
          保存为模板
        </button>
      </div>
    </section>
  );
}

export default ReportEditor;
