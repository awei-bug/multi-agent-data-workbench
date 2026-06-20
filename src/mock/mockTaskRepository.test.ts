import { describe, expect, it } from 'vitest';

import { createMockTaskEngine } from './mockTaskEngine';
import { createMockTaskRepository } from './mockTaskRepository';

describe('mock task repository', () => {
  it('returns history summaries and detail snapshots by task id', () => {
    const repository = createMockTaskRepository();

    const tasks = repository.listRecentTasks();
    const detail = repository.getTaskDetail(tasks[0].id);

    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe('east-china-sales-report');
    expect(detail?.request).toContain('2025');
    expect(detail?.exports[2].format).toBe('PDF');
    expect(detail?.snapshot.nodes[detail.snapshot.nodes.length - 1]?.status).toBe('success');
  });

  it('stores active workspace session updates in the repository', () => {
    const repository = createMockTaskRepository();
    const engine = createMockTaskEngine();
    const runningSnapshot = engine.start();

    repository.updateActiveTask({
      request: '分析华东区域季度趋势',
      snapshot: runningSnapshot,
    });

    const activeTask = repository.getActiveTask();

    expect(activeTask?.request).toBe('分析华东区域季度趋势');
    expect(activeTask?.snapshot.phase).toBe('running');
    expect(activeTask?.snapshot.nodes[0].status).toBe('running');
  });

  it('loads a history task into the active workspace session for replay', () => {
    const repository = createMockTaskRepository();

    repository.loadTaskIntoWorkspace('channel-roi-retro');

    const activeTask = repository.getActiveTask();

    expect(activeTask?.id).toBe('workspace-active-session');
    expect(activeTask?.mode).toBe('replay');
    expect(activeTask?.request).toContain('ROI');
    expect(activeTask?.snapshot.phase).toBe('running');
    expect(activeTask?.snapshot.nodes[4].status).toBe('running');
  });

  it('resets the active workspace session after replay mode exits', () => {
    const repository = createMockTaskRepository();

    repository.loadTaskIntoWorkspace('channel-roi-retro');
    repository.resetActiveTask();

    const activeTask = repository.getActiveTask();

    expect(activeTask.mode).toBe('live');
    expect(activeTask.status).toContain('等待');
    expect(activeTask.snapshot.phase).toBe('idle');
    expect(activeTask.exports).toEqual([]);
  });

  it('creates a new live session from a replay task while keeping the original request', () => {
    const repository = createMockTaskRepository();

    repository.loadTaskIntoWorkspace('channel-roi-retro');
    repository.createTaskFromReplay();

    const activeTask = repository.getActiveTask();

    expect(activeTask.mode).toBe('live');
    expect(activeTask.name).toContain('新建任务');
    expect(activeTask.status).toContain('等待');
    expect(activeTask.request).toContain('ROI');
    expect(activeTask.snapshot.phase).toBe('idle');
    expect(activeTask.snapshot.nodes.every((node) => node.status === 'pending')).toBe(true);
  });

  it('persists the current live session into recent history after export', () => {
    const repository = createMockTaskRepository();

    repository.updateActiveTask({
      name: '华北库存周报',
      status: '已导出 PDF',
      summary: '库存风险已完成初步归因。',
      request: '分析华北库存周转和断货风险，输出周报',
      exports: [{ format: 'PDF', status: 'PDF 导出完成' }],
      risks: ['需补充仓间调拨明细后再复核。'],
      dataSource: {
        kind: 'csv',
        fileName: 'inventory.csv',
        columnCount: 4,
        rowCount: 24,
        fieldMappings: [
          { source: 'week', target: '周次' },
          { source: 'stock', target: '库存' },
        ],
      },
    });

    const savedTask = repository.saveActiveTaskToHistory();
    const recentTasks = repository.listRecentTasks();
    const detail = repository.getTaskDetail(savedTask.id);

    expect(recentTasks[0].name).toBe('华北库存周报');
    expect(recentTasks[0].status).toBe('已导出 PDF');
    expect(recentTasks[0].summary).toBe('库存风险已完成初步归因。');
    expect(detail?.exports[0].status).toBe('PDF 导出完成');
    expect(detail?.risks[0]).toBe('需补充仓间调拨明细后再复核。');
    expect(detail?.dataSource).toEqual({
      kind: 'csv',
      fileName: 'inventory.csv',
      columnCount: 4,
      rowCount: 24,
      fieldMappings: [
        { source: 'week', target: '周次' },
        { source: 'stock', target: '库存' },
      ],
    });
  });

  it('updates the same saved history record when the active live session is exported again', () => {
    const repository = createMockTaskRepository();

    repository.updateActiveTask({
      name: '华北库存周报',
      status: '已导出 PDF',
      summary: '库存风险已完成初步归因。',
      request: '分析华北库存周转和断货风险，输出周报',
      exports: [{ format: 'PDF', status: 'PDF 导出完成' }],
      risks: ['需补充仓间调拨明细后再复核。'],
    });

    const firstSaved = repository.saveActiveTaskToHistory();

    repository.updateActiveTask({
      status: '已导出 Word',
      summary: '库存周报已补充管理层摘要。',
      exports: [{ format: 'Word', status: 'Word 导出完成' }],
    });

    const secondSaved = repository.saveActiveTaskToHistory();
    const recentTasks = repository.listRecentTasks();

    expect(secondSaved.id).toBe(firstSaved.id);
    expect(recentTasks.filter((task) => task.name === '华北库存周报')).toHaveLength(1);
    expect(recentTasks[0].status).toBe('已导出 Word');
    expect(recentTasks[0].summary).toBe('库存周报已补充管理层摘要。');
    expect(recentTasks[0].exports[0].status).toBe('Word 导出完成');
  });

  it('stores the current workspace session as a reusable template', () => {
    const repository = createMockTaskRepository();

    repository.updateActiveTask({
      summary: '沉淀一个适合客单价波动复盘的模板。',
      request: '分析华东区域客单价变化并形成复盘模板',
    });

    const savedTemplate = repository.saveActiveTaskAsTemplate();
    const templates = repository.listTemplates();

    expect(savedTemplate.name).toBe('分析华东区域客单价变化并形成复盘模板');
    expect(savedTemplate.tag).toBe('来自工作台');
    expect(templates[0].name).toBe('分析华东区域客单价变化并形成复盘模板');
    expect(templates[0].source).toBe('workspace');
  });

  it('duplicates an existing template and keeps the original template', () => {
    const repository = createMockTaskRepository();

    const duplicatedTemplate = repository.duplicateTemplate('template-business-retro');
    const templates = repository.listTemplates();

    expect(duplicatedTemplate?.name).toBe('经营复盘模板 副本');
    expect(duplicatedTemplate?.tag).toBe('来自模板复制');
    expect(templates[0].name).toBe('经营复盘模板 副本');
    expect(templates.some((template) => template.id === 'template-business-retro')).toBe(true);
  });
});
