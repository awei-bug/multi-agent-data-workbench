import { useEffect, useId, useMemo, useState } from 'react';

import type { PreviewColumn, PreviewDataset, PreviewRow } from '../../mock/mockData';
import { parseCsvPreview } from '../../pages/workspaceSampleData';
import type { TaskDataSourceRecord } from '../../types/tasks';
import { workspaceFetch } from '../../utils/workspaceIdentity';

type MappingDraft = Record<string, string>;

type DataSourceUploaderProps = {
  onImportDataSource?: (dataSource: TaskDataSourceRecord) => void;
  onConfirmCsvMapping?: (mappingSummary: string) => void;
  initialLoaded?: boolean;
  showPreview?: boolean;
};

const mappingSuggestions: Record<string, string> = {
  month: '月份',
  region: '区域',
  sales: '销售额',
};

const acceptedTypes =
  '.csv,.xls,.xlsx,.xlsm,.json,.txt,.md,.docx,.pdf,text/csv,application/vnd.ms-excel,application/json,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const maxUploadFileBytes = 7_000_000;

function buildInitialMapping(headers: string[]) {
  return headers.reduce<MappingDraft>((draft, header) => {
    draft[header] = mappingSuggestions[header] ?? header;
    return draft;
  }, {});
}

function buildPreviewDataset(dataSource: TaskDataSourceRecord): PreviewDataset | null {
  if (!dataSource.columns?.length || !dataSource.previewRows?.length) {
    return null;
  }

  const columns: PreviewColumn[] = dataSource.columns.map((column) => ({
    name: column.name,
    type: column.type,
    missingRate: '--',
  }));

  const rows: PreviewRow[] = dataSource.previewRows.map((row) => ({ ...row }));
  return { columns, rows };
}

function buildJsonDataSource(fileName: string, text: string): TaskDataSourceRecord {
  const payload = JSON.parse(text) as Record<string, unknown> | Array<Record<string, unknown>>;
  const items = Array.isArray(payload) ? payload : [payload];
  const headers = Array.from(new Set(items.flatMap((item) => Object.keys(item ?? {}))));
  const previewRows = items.map((item) =>
    headers.reduce<Record<string, string>>((record, header) => {
      const value = item?.[header];
      record[header] = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
      return record;
    }, {}),
  );

  return {
    kind: 'table',
    formatLabel: 'JSON',
    fileName,
    columnCount: headers.length,
    rowCount: previewRows.length,
    columns: headers.map((header) => ({ name: header, type: 'string' })),
    previewRows,
    analysisRows: previewRows,
    textPreview: '',
    fieldMappings: [],
  };
}

function buildTextDataSource(fileName: string, text: string, formatLabel: string): TaskDataSourceRecord {
  const preview = text.trim().slice(0, 2000);
  const rowCount = preview ? preview.split(/\r?\n/).filter(Boolean).length : 0;
  return {
    kind: 'document',
    formatLabel,
    fileName,
    columnCount: 0,
    rowCount,
    columns: [],
    previewRows: [],
    analysisRows: [],
    textPreview: preview,
    fieldMappings: [],
  };
}

async function readFileText(file: File) {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

async function parseFileLocally(file: File): Promise<TaskDataSourceRecord> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.csv')) {
    const text = await readFileText(file);
    const preview = parseCsvPreview(text);
    return {
      kind: 'csv',
      formatLabel: 'CSV',
      fileName: file.name,
      columnCount: preview.columns.length,
      rowCount: preview.rows.length,
      columns: preview.columns.map((column) => ({ name: column.name, type: column.type })),
      previewRows: preview.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? '')]))),
      analysisRows: preview.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? '')]))),
      textPreview: '',
      fieldMappings: [],
    };
  }

  if (lowerName.endsWith('.json')) {
    return buildJsonDataSource(file.name, await readFileText(file));
  }

  if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
    return buildTextDataSource(file.name, await readFileText(file), lowerName.endsWith('.md') ? 'Markdown' : 'Text');
  }

  throw new Error('当前未连接后端时，仅支持 CSV、JSON、TXT、Markdown 的本地解析。');
}

function DataSourceUploader({
  onImportDataSource,
  onConfirmCsvMapping,
  initialLoaded = false,
  showPreview = true,
}: DataSourceUploaderProps) {
  const inputId = useId();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;
  const [loaded, setLoaded] = useState(initialLoaded);
  const [preview, setPreview] = useState<PreviewDataset | null>(null);
  const [documentPreview, setDocumentPreview] = useState('');
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (initialLoaded) setLoaded(true);
  }, [initialLoaded]);

  const previewHeaders = useMemo(() => preview?.columns.map((column) => column.name) ?? [], [preview]);
  const sortedRows = useMemo(() => {
    if (!preview) return [];
    if (!sortColumn) return preview.rows;
    return [...preview.rows].sort((left, right) => String(left[sortColumn] ?? '').localeCompare(String(right[sortColumn] ?? '')));
  }, [preview, sortColumn]);

  const applyDataSource = (dataSource: TaskDataSourceRecord) => {
    setLoaded(true);
    setErrorMessage('');
    setSortColumn(null);
    setDocumentPreview(dataSource.textPreview ?? '');
    setPreview(buildPreviewDataset(dataSource));
    setMappingDraft(dataSource.kind === 'document' ? {} : buildInitialMapping(dataSource.columns?.map((column) => column.name) ?? []));
    setMappingConfirmed(false);
    onImportDataSource?.(dataSource);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > maxUploadFileBytes) {
      setErrorMessage('文件不能超过 7MB。');
      event.target.value = '';
      return;
    }

    try {
      let dataSource: TaskDataSourceRecord;
      if (apiBaseUrl) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await workspaceFetch(`${apiBaseUrl}/api/data-source/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { detail?: string; message?: string } | null;
          throw new Error(payload?.detail || payload?.message || `文件解析失败: ${response.status}`);
        }

        dataSource = (await response.json()) as TaskDataSourceRecord;
      } else {
        dataSource = await parseFileLocally(file);
      }

      applyDataSource({
        ...dataSource,
        originalMimeType: dataSource.originalMimeType ?? file.type ?? 'application/octet-stream',
        originalFileSize: dataSource.originalFileSize ?? file.size,
        fieldMappings: dataSource.fieldMappings ?? [],
        columns: dataSource.columns ?? [],
        previewRows: dataSource.previewRows ?? [],
        analysisRows: dataSource.analysisRows ?? dataSource.previewRows ?? [],
        textPreview: dataSource.textPreview ?? '',
      });
    } catch (error) {
      setLoaded(false);
      setPreview(null);
      setDocumentPreview('');
      setMappingDraft({});
      setMappingConfirmed(false);
      setErrorMessage(error instanceof Error ? error.message : '文件解析失败');
    } finally {
      event.target.value = '';
    }
  };

  const handleMappingChange = (header: string, value: string) => {
    setMappingDraft((current) => ({ ...current, [header]: value }));
  };

  const handleConfirmMapping = () => {
    const summary = previewHeaders.map((header) => `${header}->${mappingDraft[header] ?? header}`).join(', ');
    setMappingConfirmed(true);
    onConfirmCsvMapping?.(`字段映射已确认：${summary}`);
  };

  const getColumnAccent = (type: string) => {
    if (type === 'date') return 'preview-accent-date';
    if (type === 'number') return 'preview-accent-number';
    return 'preview-accent-text';
  };

  return (
    <section className="content-card workspace-section" id="data-source-uploader">
      <div className="section-heading">
        <span className="section-index">01</span>
        <div>
          <h3>数据源接入</h3>
          <p>接入 CSV、Excel、JSON、文本、Markdown、Word、PDF，并立即给出结构预览。</p>
        </div>
      </div>

      <div className="upload-dropzone upload-dropzone-enterprise">
        <div className="upload-dropzone-copy">
          <strong>将文件拖到这里，或直接点击上传</strong>
          <p>上传完成后立即生成字段结构、样例数据和后续分析所需的映射草稿。</p>
          <div className="upload-meta-row">
            <span>支持格式：CSV / Excel / JSON / TXT / Markdown / Word / PDF</span>
            <span>大小限制：7MB</span>
          </div>
        </div>
        <div className="actions-row">
          <label className="action-button" htmlFor={inputId}>
            上传文件
          </label>
          <input id={inputId} aria-label="上传文件" type="file" accept={acceptedTypes} hidden onChange={handleFileChange} />
        </div>
        {errorMessage ? <p className="status-note">{errorMessage}</p> : null}
      </div>

      {loaded && showPreview ? (
        <div className="preview-grid preview-grid-enterprise">
          {preview ? (
            <>
              <div className="preview-card">
                <div className="section-heading">
                  <span className="section-index">FD</span>
                  <div>
                    <h4>字段概览</h4>
                    <p className="inline-tip">关键字段类型会用颜色区分，便于快速识别日期列和数值列。</p>
                  </div>
                </div>
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
                <div className="section-heading">
                  <span className="section-index">PV</span>
                  <div>
                    <h4>样例数据</h4>
                    <p className="inline-tip">点击列名按钮可快速切换排序预览。</p>
                  </div>
                </div>
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
            </>
          ) : null}

          {documentPreview ? (
            <div className="preview-card">
              <div className="section-heading">
                <span className="section-index">DC</span>
                <div>
                  <h4>文档预览</h4>
                  <p className="inline-tip">已提取可分析文本片段，后续需求解析会直接消费这里的内容。</p>
                </div>
              </div>
              <pre className="document-preview">{documentPreview}</pre>
            </div>
          ) : null}

          {Object.keys(mappingDraft).length > 0 ? (
            <div className="preview-card">
              <div className="section-heading">
                <span className="section-index">MP</span>
                <div>
                  <h4>字段映射确认</h4>
                  <p className="inline-tip">确认字段口径后，再进入需求解析和图表生成阶段。</p>
                </div>
              </div>
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
              {mappingConfirmed ? <p className="status-note">字段映射已确认，可以继续进入需求解析。</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default DataSourceUploader;
