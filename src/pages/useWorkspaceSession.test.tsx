import { act, renderHook } from '@testing-library/react';
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
      result.current.handleChartTitleChange('修正后销售趋势');
    });

    expect(result.current.reportSummary.split('\n')).toEqual([
      '图表标题已更新为“修正后销售趋势”。',
      '已人工修正样例值：0-销售额为 3200。',
      '当前会话尚未启动，等待样例数据与分析需求输入。',
    ]);
  });

  it('creates a live task from parsed intent and persists export status', () => {
    const { result } = renderHook(() => useWorkspaceSession(), {
      wrapper: createWrapper(),
    });

    act(() => {
      void result.current.handleParse({
        request: '分析华东销售趋势并输出复盘摘要',
        goal: '华东销售趋势复盘',
        metrics: '销售额、环比',
        dimensions: '月份、区域',
        charts: '趋势图',
      });
    });

    act(() => {
      result.current.handleExport({
        format: 'PDF',
        status: 'PDF 导出完成',
      });
    });

    expect(result.current.reportSummary).toBe('围绕华东销售趋势复盘输出执行摘要。');
    expect(result.current.exportStatus).toBe('PDF 导出完成');
    expect(result.current.activeTask.name).toBe('华东销售趋势复盘');
    expect(result.current.activeTask.status).toBe('已导出 PDF');
    expect(result.current.activeTask.exports).toEqual([{ format: 'PDF', status: 'PDF 导出完成' }]);
  });

  it('keeps the latest request draft before parsing', () => {
    const { result } = renderHook(() => useWorkspaceSession(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.handleRequestDraftChange('分析华东区域客单价变化并形成复盘模板');
    });

    expect(result.current.composerValue).toBe('分析华东区域客单价变化并形成复盘模板');
  });

  it('stores confirmed csv field mapping summary in the active task summary and data source state', () => {
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
      result.current.handleConfirmCsvMapping('字段映射已确认：month->月份，region->区域，sales->销售额');
    });

    expect(result.current.activeTask.summary).toContain('字段映射已确认：month->月份，region->区域，sales->销售额');
    expect(result.current.reportSummary).toContain('字段映射已确认：month->月份，region->区域，sales->销售额');
    expect(result.current.activeTask.dataSource).toMatchObject({
      kind: 'csv',
      fileName: 'sales.csv',
      columnCount: 3,
      rowCount: 2,
      fieldMappings: [
        { source: 'month', target: '月份' },
        { source: 'region', target: '区域' },
        { source: 'sales', target: '销售额' },
      ],
    });
  });

  it('blocks workflow start with a node-level validation reason when required metric mapping is missing', () => {
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

    expect(result.current.snapshot.phase).toBe('idle');
    expect(result.current.snapshot.logMessage).toBe('销售额字段缺少数值列映射，请将数值字段映射为“销售额”。');
    expect(result.current.reportSummary).toContain('销售额字段缺少数值列映射，请将数值字段映射为“销售额”。');
    expect(result.current.activeTask.risks[0]).toBe('销售额字段缺少数值列映射，请将数值字段映射为“销售额”。');
  });

  it('stores structured validation issues after confirming conflicting csv field mappings', () => {
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
      result.current.handleConfirmCsvMapping('字段映射已确认：month->月份，region->区域，sales->区域');
    });

    expect((result.current.activeTask.dataSource as any)?.validationIssues).toEqual([
      '字段“区域”被重复映射，请保持一列只对应一个业务字段。',
      '销售额字段缺少数值列映射，请将数值字段映射为“销售额”。',
    ]);
  });
});
