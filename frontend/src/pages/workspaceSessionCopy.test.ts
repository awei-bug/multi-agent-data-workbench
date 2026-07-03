import { describe, expect, it } from 'vitest';

import {
  buildChartTitleSummary,
  buildExportTaskStatus,
  buildIntentSummary,
  buildManualRevisionSummary,
  buildPauseSummary,
  CHART_TITLE_PREFIX,
  DEFAULT_EXPORT_STATUS,
  DEFAULT_REQUEST,
  DEFAULT_SUMMARY,
  EMPTY_REQUEST,
  MANUAL_REVISION_PREFIX,
} from './workspaceSessionCopy';

describe('workspace session copy helpers', () => {
  it('exposes non-empty default copy', () => {
    expect(DEFAULT_REQUEST).not.toHaveLength(0);
    expect(DEFAULT_SUMMARY).not.toHaveLength(0);
    expect(DEFAULT_EXPORT_STATUS).not.toHaveLength(0);
    expect(EMPTY_REQUEST).not.toHaveLength(0);
  });

  it('builds summary entries from provided values', () => {
    expect(buildIntentSummary('goal')).toContain('goal');
    expect(buildManualRevisionSummary('3200')).toContain(MANUAL_REVISION_PREFIX);
    expect(buildManualRevisionSummary('3200')).toContain('3200');
    expect(buildChartTitleSummary('chart title')).toContain(CHART_TITLE_PREFIX);
    expect(buildChartTitleSummary('chart title')).toContain('chart title');
  });

  it('builds pause and export status copy', () => {
    expect(buildPauseSummary('agent')).toContain('agent');
    expect(buildPauseSummary()).not.toHaveLength(0);
    expect(buildExportTaskStatus('PDF')).toContain('PDF');
  });
});
