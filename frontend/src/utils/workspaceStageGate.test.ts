import { describe, expect, it } from 'vitest';

import { createEmptyTask } from '../pages/emptyTask';
import { canEnterStage, evaluateStageAccess, hasMeaningfulRequest } from './workspaceStageGate';

const withData = () => ({
  ...createEmptyTask(),
  dataSource: {
    kind: 'table' as const,
    fileName: 'sales.csv',
    columnCount: 2,
    rowCount: 2,
    fieldMappings: [],
  },
});

describe('workspaceStageGate', () => {
  it('blocks execution without data source', () => {
    const task = createEmptyTask();
    const gate = evaluateStageAccess('execution', task);
    expect(gate.allowed).toBe(false);
    expect(gate.redirectTo).toBe('input');
    expect(gate.ctaPath).toBe('/data-sources');
  });

  it('blocks execution without intent', () => {
    const task = withData();
    task.request = '尚未填写分析需求。';
    expect(canEnterStage('execution', task)).toBe(false);
    expect(hasMeaningfulRequest(task)).toBe(false);
  });

  it('allows execution after meaningful request', () => {
    const task = withData();
    task.request = '分析各区域销售额';
    expect(canEnterStage('execution', task)).toBe(true);
  });

  it('blocks output before completion', () => {
    const task = withData();
    task.request = '分析销售';
    const gate = evaluateStageAccess('output', task);
    expect(gate.allowed).toBe(false);
    expect(gate.redirectTo).toBe('execution');
  });

  it('allows output after completion', () => {
    const base = withData();
    const task = {
      ...base,
      request: '分析销售',
      snapshot: { ...base.snapshot, phase: 'completed' as const },
    };
    expect(canEnterStage('output', task)).toBe(true);
  });

  it('allows output after failure so user can review', () => {
    const base = withData();
    const task = {
      ...base,
      request: '分析销售',
      snapshot: { ...base.snapshot, phase: 'failed' as const },
    };
    expect(canEnterStage('output', task)).toBe(true);
  });

  it('allows execution when already running even if request is placeholder', () => {
    const base = withData();
    const task = {
      ...base,
      request: '',
      snapshot: { ...base.snapshot, phase: 'running' as const },
    };
    expect(canEnterStage('execution', task)).toBe(true);
  });
});
