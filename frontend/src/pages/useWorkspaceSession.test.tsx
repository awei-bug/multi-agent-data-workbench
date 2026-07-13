import { act, renderHook, waitFor } from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { WorkbenchShellContext } from '../context/WorkbenchShellContext';
import { createMockTaskRepository } from '../mock/mockTaskRepository';
import { defaultWorkbenchContext, type WorkbenchShellContext as WorkbenchShellState } from '../types/workbench';
import { useWorkspaceSession } from './useWorkspaceSession';

function createWrapper() {
  const repository = createMockTaskRepository();
  repository.resetActiveTask();

  return function Wrapper({ children }: PropsWithChildren) {
    const [context, setContext] = useState(defaultWorkbenchContext);
    const [activeTask, setActiveTask] = useState(repository.getActiveTask());

    const value: WorkbenchShellState = {
      context,
      setContext,
      activeTask,
      setActiveTask,
    };

    return <WorkbenchShellContext.Provider value={value}>{children}</WorkbenchShellContext.Provider>;
  };
}

describe('useWorkspaceSession', () => {
  it('syncs manual revision and chart title updates into the report summary', () => {
    const { result } = renderHook(() => useWorkspaceSession(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.handleManualRevision('3200');
    });

    act(() => {
      result.current.handleChartTitleChange('chart title');
    });

    expect(result.current.reportSummary).toContain('3200');
    expect(result.current.reportSummary).toContain('chart title');
  });

  it('creates a live task from parsed intent and persists export status', async () => {
    const { result } = renderHook(() => useWorkspaceSession(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.handleParse({
        request: 'analyze sales',
        goal: 'sales review',
        metrics: 'sales',
        dimensions: 'month',
        charts: 'trend',
      });
    });

    act(() => {
      result.current.handleExport({
        format: 'PDF',
        status: 'PDF done',
      });
    });

    await waitFor(() => {
      expect(result.current.reportSummary).not.toHaveLength(0);
      expect(result.current.exportStatus).toBe('PDF done');
      expect(result.current.activeTask.name).not.toHaveLength(0);
      expect(result.current.activeTask.exports[0]).toEqual({ format: 'PDF', status: 'PDF done' });
    });
  });

  it('keeps the latest request draft before parsing', () => {
    const { result } = renderHook(() => useWorkspaceSession(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.handleRequestDraftChange('draft request');
    });

    expect(result.current.composerValue).toBe('draft request');
  });

  it('stores confirmed csv mapping in active task data source', async () => {
    const { result } = renderHook(() => useWorkspaceSession(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.handleImportCsvData('sales.csv', 3, 2, [
        { name: 'month', type: 'date' },
        { name: 'region', type: 'string' },
        { name: 'sales', type: 'number' },
      ]);
    });

    await waitFor(() => {
      expect(result.current.activeTask.dataSource?.fileName).toBe('sales.csv');
    });

    act(() => {
      result.current.handleConfirmCsvMapping('字段映射已确认：month->月份，region->区域，sales->销售额');
    });

    await waitFor(() => {
      expect(result.current.activeTask.dataSource).toMatchObject({
        kind: 'csv',
        fileName: 'sales.csv',
        columnCount: 3,
        rowCount: 2,
      });
      expect(result.current.activeTask.dataSource?.fieldMappings.length).toBe(3);
    });
  });

  it('starts workflow when uploaded fields do not use sales naming', async () => {
    const { result } = renderHook(() => useWorkspaceSession(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.handleImportCsvData('sales.csv', 3, 2, [
        { name: 'month', type: 'date' },
        { name: 'region', type: 'string' },
        { name: 'sales', type: 'number' },
      ]);
    });

    act(() => {
      result.current.handleConfirmCsvMapping('字段映射已确认：month->月份，region->区域，sales->订单编号');
    });

    act(() => {
      result.current.handleStart();
    });

    await waitFor(() => {
      expect(result.current.snapshot.phase).toBe('running');
    });
  });

  it('stores validation issues after conflicting csv field mappings', async () => {
    const { result } = renderHook(() => useWorkspaceSession(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.handleImportCsvData('sales.csv', 3, 2, [
        { name: 'month', type: 'date' },
        { name: 'region', type: 'string' },
        { name: 'sales', type: 'number' },
      ]);
    });

    await waitFor(() => {
      expect(result.current.activeTask.dataSource?.fileName).toBe('sales.csv');
    });

    act(() => {
      result.current.handleConfirmCsvMapping('字段映射已确认：month->月份，region->区域，sales->区域');
    });

    await waitFor(() => {
      expect(result.current.activeTask.dataSource?.validationIssues).toBeDefined();
    });
  });
});
