import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyTask } from '../pages/emptyTask';
import {
  applyDemoTaskLocally,
  buildDemoDataset,
  runFullDemoFlow,
  startDemoAnalysisFlow,
} from './demoFlow';

describe('demoFlow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a tabular demo dataset with expected shape', () => {
    const dataset = buildDemoDataset();
    expect(dataset.fileName).toContain('2025');
    expect(dataset.columnCount).toBe(8);
    expect(dataset.rowCount).toBe(12);
    expect(dataset.columns?.map((item) => item.name)).toEqual([
      '月份',
      '区域',
      '渠道',
      '订单数',
      '销售额',
      '毛利率',
      '投放费用',
      '转化率',
    ]);
  });

  it('applies demo task locally when backend is unavailable', () => {
    const current = createEmptyTask();
    const next = applyDemoTaskLocally(current);
    expect(next.dataSource?.fileName).toContain('2025');
    expect(next.request).toContain('2025');
    expect(next.snapshot.phase).toBe('idle');
    expect(next.snapshot.nodes[0]?.status).toBe('success');
  });

  it('starts demo analysis flow via upload + bind + patch when api is available', async () => {
    const current = createEmptyTask();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/data-source/upload') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'uploaded-demo-1', fileName: '2025经营销售样例数据.csv' }), {
          status: 200,
        });
      }
      if (url.includes('/api/tasks/active/dataset/') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/active-task') && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            ...current,
            name: '2025 经营销售分析（示例演示）',
            request: '分析 2025 年月度销售额趋势、区域差异、渠道表现和投放效率，并输出管理层报告。',
            status: '样例数据已就绪',
            dataSource: {
              kind: 'table',
              fileName: '2025经营销售样例数据.csv',
              columnCount: 8,
              rowCount: 12,
              fieldMappings: [],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const task = await startDemoAnalysisFlow({ apiBaseUrl: '', currentTask: current });
    expect(task.dataSource?.fileName).toContain('2025');
    expect(task.request).toContain('管理层报告');

    const remoteTask = await startDemoAnalysisFlow({ apiBaseUrl: 'http://127.0.0.1:8787', currentTask: current });
    expect(remoteTask.name).toContain('示例演示');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('runs full demo flow to delivery in local mode', async () => {
    const current = createEmptyTask();
    const stages: string[] = [];
    const result = await runFullDemoFlow({
      apiBaseUrl: '',
      currentTask: current,
      autoStart: true,
      onProgress: (progress) => stages.push(progress.stage),
    });

    expect(result.reachedDelivery).toBe(true);
    expect(result.task.snapshot.phase).toBe('completed');
    expect(result.intent.goal).toContain('2025');
    expect(stages).toContain('prepare');
    expect(stages).toContain('parse');
    expect(stages).toContain('execute');
    expect(stages).toContain('done');
  });
});
