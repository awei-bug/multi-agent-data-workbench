import type { WorkflowSnapshot } from '../mock/mockTaskEngine';

export type ExportRecord = {
  format: 'Markdown' | 'Word' | 'PDF' | 'HTML' | string;
  status: string;
  artifactId?: string;
};

export type FieldMappingRecord = {
  source: string;
  target: string;
};

export type DataSourceColumnRecord = {
  name: string;
  type: string;
};

export type DataSourcePreviewRowRecord = Record<string, string>;

export type TaskDataSourceRecord = {
  kind: 'csv' | 'table' | 'document';
  formatLabel?: string;
  fileName: string;
  columnCount: number;
  rowCount: number;
  columns?: DataSourceColumnRecord[];
  previewRows?: DataSourcePreviewRowRecord[];
  analysisRows?: DataSourcePreviewRowRecord[];
  analysisScope?: { mode: 'full' | 'sampled' | 'rejected' | string; rowCount: number; rowsProcessed: number; reason?: string };
  profile?: {
    nullCounts?: Record<string, number>;
    duplicateRows?: number;
    charCount?: number;
    wordCount?: number;
    lineCount?: number;
    paragraphCount?: number;
    keywords?: Array<{ term: string; count: number }>;
    sampleParagraphs?: string[];
  };
  textPreview?: string;
  fullText?: string;
  storageKey?: string;
  originalMimeType?: string;
  originalFileSize?: number;
  fieldMappings: FieldMappingRecord[];
  validationIssues?: string[];
};

export type ExecutionLogRecord = {
  at: string;
  kind: 'system' | 'action' | 'advance' | 'export';
  message: string;
};

export type WorkflowExecutionMeta = {
  mode?: 'async' | 'sync' | string;
  status?: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | string;
  jobId?: string | null;
  action?: string | null;
  submittedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastError?: string | null;
  steps?: number;
  cancelRequested?: boolean;
};

export type TaskArtifactRecord = {
  nodeId?: string;
  label?: string;
  type: string;
  content?: Record<string, unknown>;
  warnings?: string[];
  id?: string;
  downloadUrl?: string;
};

export type TaskRecord = {
  id: string;
  name: string;
  mode: 'live' | 'replay';
  status: string;
  time: string;
  summary: string;
  request: string;
  intent?: {
    request?: string;
    goal?: string;
    metrics?: string;
    dimensions?: string;
    charts?: string;
    analysisMode?: 'table' | 'document' | string;
  };
  snapshot: WorkflowSnapshot;
  exports: ExportRecord[];
  risks: string[];
  dataSource?: TaskDataSourceRecord;
  artifacts?: TaskArtifactRecord[];
  executionLog?: ExecutionLogRecord[];
  execution?: WorkflowExecutionMeta;
};
