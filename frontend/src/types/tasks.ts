import type { WorkflowSnapshot } from '../mock/mockTaskEngine';

export type ExportRecord = {
  format: 'Markdown' | 'Word' | 'PDF';
  status: string;
};

export type FieldMappingRecord = {
  source: string;
  target: string;
};

export type DataSourceColumnRecord = {
  name: string;
  type: string;
};

export type TaskDataSourceRecord = {
  kind: 'csv';
  fileName: string;
  columnCount: number;
  rowCount: number;
  columns?: DataSourceColumnRecord[];
  fieldMappings: FieldMappingRecord[];
  validationIssues?: string[];
};

export type ExecutionLogRecord = {
  at: string;
  kind: 'system' | 'action' | 'advance' | 'export';
  message: string;
};

export type TaskRecord = {
  id: string;
  name: string;
  mode: 'live' | 'replay';
  status: string;
  time: string;
  summary: string;
  request: string;
  snapshot: WorkflowSnapshot;
  exports: ExportRecord[];
  risks: string[];
  dataSource?: TaskDataSourceRecord;
  executionLog?: ExecutionLogRecord[];
};
