import { useId, useMemo, useState } from 'react';

import type { PreviewDataset } from '../../mock/mockData';
import { getDefaultPreviewDataset, parseCsvPreview } from '../../pages/workspaceSampleData';
import type { DataSourceColumnRecord } from '../../types/tasks';

type MappingDraft = Record<string, string>;

type DataSourceUploaderProps = {
  onLoadSampleData?: () => void;
  onImportCsvData?: (fileName: string, columnCount: number, rowCount: number, columns: DataSourceColumnRecord[]) => void;
  onConfirmCsvMapping?: (mappingSummary: string) => void;
  initialLoaded?: boolean;
};

const mappingSuggestions: Record<string, string> = {
  month: '月份',
  region: '区域',
  sales: '销售额',
};

function buildInitialMapping(headers: string[]) {
  return headers.reduce<MappingDraft>((draft, header) => {
    draft[header] = mappingSuggestions[header] ?? header;
    return draft;
  }, {});
}

function DataSourceUploader({
  onLoadSampleData,
  onImportCsvData,
  onConfirmCsvMapping,
  initialLoaded = false,
}: DataSourceUploaderProps) {
  const inputId = useId();
  const [loaded, setLoaded] = useState(initialLoaded);
  const [preview, setPreview] = useState<PreviewDataset>(() => getDefaultPreviewDataset());
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);

  const previewHeaders = useMemo(() => preview.columns.map((column) => column.name), [preview.columns]);
  const sortedRows = useMemo(() => {
    if (!sortColumn) {
      return preview.rows;
    }

    return [...preview.rows].sort((left, right) => String(left[sortColumn] ?? '').localeCompare(String(right[sortColumn] ?? '')));
  }, [preview.rows, sortColumn]);

  const handleLoadSampleData = () => {
    setPreview(getDefaultPreviewDataset());
    setLoaded(true);
    setMappingDraft({});
    setMappingConfirmed(false);
    onLoadSampleData?.();
  };

  const readFileText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      if (typeof file.text === 'function') {
        file.text().then(resolve).catch(reject);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('读取 CSV 文件失败'));
      reader.readAsText(file);
    });

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const text = await readFileText(file);
    const nextPreview = parseCsvPreview(text);

    setPreview(nextPreview);
    setLoaded(true);
    setMappingDraft(buildInitialMapping(nextPreview.columns.map((column) => column.name)));
    setMappingConfirmed(false);
    setSortColumn(null);
    onImportCsvData?.(
      file.name,
      nextPreview.columns.length,
      nextPreview.rows.length,
      nextPreview.columns.map((column) => ({ name: column.name, type: column.type })),
    );
    event.target.value = '';
  };

  const handleMappingChange = (header: string, value: string) => {
    setMappingDraft((current) => ({
      ...current,
      [header]: value,
    }));
  };

  const handleConfirmMapping = () => {
    const summary = previewHeaders.map((header) => `${header}->${mappingDraft[header] ?? header}`).join(', ');
    setMappingConfirmed(true);
    onConfirmCsvMapping?.(`字段映射已确认：${summary}`);
  };

  const getColumnAccent = (type: string) => {
    if (type === 'date') {
      return 'preview-accent-date';
    }

    if (type === 'number') {
      return 'preview-accent-number';
    }

    return 'preview-accent-text';
  };

  return (
    <section className="content-card workspace-section">
      <div className="section-heading">
        <span className="section-index">01</span>
        <div>
          <h3>数据源接入</h3>
          <p>上传 CSV、检查结构、排序关键字段，并在主流程启动前确认字段映射。</p>
        </div>
      </div>
      <div className="upload-dropzone">
        <strong>将文件拖到这里</strong>
        <p>或选择本地 CSV 文件。日期和数值字段会在预览区优先突出显示。</p>
        <div className="actions-row">
          <label className="action-button" htmlFor={inputId}>
            上传 CSV
          </label>
          <input id={inputId} type="file" accept=".csv,text/csv" hidden onChange={handleFileChange} />
          <button className="action-button secondary-button" type="button" onClick={handleLoadSampleData}>
            加载示例数据
          </button>
        </div>
      </div>
      {loaded ? (
        <div className="preview-grid">
          <div className="preview-card">
            <h4>字段概览</h4>
            <ul className="field-list">
              {preview.columns.map((column) => (
                <li key={column.name} className={`field-card ${getColumnAccent(column.type)}`}>
                  <strong>{column.name}</strong>
                  <span>{`${column.type} / 缺失 ${column.missingRate}`}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="preview-card">
            <h4>样例数据</h4>
            <p className="inline-tip">关键字段已自动标记。点击列名可快速排序预览。</p>
            <div className="actions-row">
              {previewHeaders.map((header) => (
                <button
                  key={header}
                  className="action-button secondary-button"
                  type="button"
                  onClick={() => setSortColumn(header)}
                >
                  按 {header} 排序
                </button>
              ))}
            </div>
            <table className="preview-table">
              <thead>
                <tr>
                  {preview.columns.map((column) => (
                    <th key={column.name} className={getColumnAccent(column.type)}>
                      {column.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => (
                  <tr key={`${previewHeaders.join('-')}-${index}`}>
                    {preview.columns.map((column) => (
                      <td key={`${column.name}-${index}`} className={getColumnAccent(column.type)}>
                        {row[column.name] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(mappingDraft).length > 0 ? (
            <div className="preview-card">
              <h4>字段映射确认</h4>
              <ul className="field-list">
                {previewHeaders.map((header) => (
                  <li key={header}>
                    <strong>{header}</strong>
                    <label>
                      <span className="sr-only">{`映射 ${header}`}</span>
                      <select
                        className="text-input"
                        value={mappingDraft[header] ?? header}
                        onChange={(event) => handleMappingChange(header, event.target.value)}
                      >
                        <option value="月份">月份</option>
                        <option value="区域">区域</option>
                        <option value="销售额">销售额</option>
                        <option value={header}>{header}</option>
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="actions-row">
                <button className="action-button" type="button" onClick={handleConfirmMapping}>
                  确认字段映射
                </button>
              </div>
              {mappingConfirmed ? <p className="status-note">字段映射已确认，可以继续进行需求解析。</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default DataSourceUploader;
