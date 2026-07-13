import { describe, expect, it } from 'vitest';

import { createEmptyTask } from '../pages/emptyTask';
import { buildContinuePlan, resolveContinuePath } from './continuePlan';

describe('continuePlan', () => {
  it('routes users without data source to data-sources', () => {
    const task = createEmptyTask();
    const plan = buildContinuePlan(task);
    expect(plan.primaryPath).toBe('/data-sources');
    expect(resolveContinuePath(task)).toBe('/data-sources');
  });

  it('routes users with data but no request to workspace input', () => {
    const task = {
      ...createEmptyTask(),
      dataSource: {
        kind: 'table' as const,
        fileName: 'sales.csv',
        columnCount: 2,
        rowCount: 2,
        fieldMappings: [],
      },
      request: '尚未填写分析需求。',
    };
    expect(resolveContinuePath(task)).toBe('/workspace?step=input');
  });

  it('routes running jobs to execution', () => {
    const base = createEmptyTask();
    const task = {
      ...base,
      dataSource: {
        kind: 'table' as const,
        fileName: 'sales.csv',
        columnCount: 2,
        rowCount: 2,
        fieldMappings: [],
      },
      request: '分析销售趋势',
      snapshot: {
        ...base.snapshot,
        phase: 'running' as const,
      },
      execution: { mode: 'async', status: 'running' },
    };
    expect(resolveContinuePath(task)).toBe('/workspace?step=execution');
  });

  it('routes completed jobs to output', () => {
    const base = createEmptyTask();
    const task = {
      ...base,
      dataSource: {
        kind: 'table' as const,
        fileName: 'sales.csv',
        columnCount: 2,
        rowCount: 2,
        fieldMappings: [],
      },
      request: '分析销售趋势',
      snapshot: {
        ...base.snapshot,
        phase: 'completed' as const,
      },
    };
    expect(resolveContinuePath(task)).toBe('/workspace?step=output');
  });
});
