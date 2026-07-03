import { describe, expect, it } from 'vitest';

import { createMockTaskEngine } from './mockTaskEngine';
import { createMockTaskRepository } from './mockTaskRepository';

describe('mock task repository', () => {
  it('returns history summaries and detail snapshots by task id', () => {
    const repository = createMockTaskRepository();

    const tasks = repository.listRecentTasks();
    const detail = repository.getTaskDetail(tasks[0].id);

    expect(tasks).toHaveLength(2);
    expect(detail?.id).toBe(tasks[0].id);
    expect(detail?.exports.length).toBeGreaterThan(0);
  });

  it('stores active workspace session updates', () => {
    const repository = createMockTaskRepository();
    const runningSnapshot = createMockTaskEngine().start();

    repository.updateActiveTask({
      request: 'analyze region trend',
      snapshot: runningSnapshot,
    });

    const activeTask = repository.getActiveTask();

    expect(activeTask.request).toBe('analyze region trend');
    expect(activeTask.snapshot.phase).toBe('running');
    expect(activeTask.snapshot.nodes[0].status).toBe('running');
  });

  it('loads a history task into replay mode', () => {
    const repository = createMockTaskRepository();
    const task = repository.listRecentTasks()[1];

    repository.loadTaskIntoWorkspace(task.id);

    const activeTask = repository.getActiveTask();

    expect(activeTask.id).toBe('workspace-active-session');
    expect(activeTask.mode).toBe('replay');
    expect(activeTask.request).toBe(task.request);
  });

  it('resets active workspace after replay mode exits', () => {
    const repository = createMockTaskRepository();
    const task = repository.listRecentTasks()[1];

    repository.loadTaskIntoWorkspace(task.id);
    repository.resetActiveTask();

    const activeTask = repository.getActiveTask();

    expect(activeTask.mode).toBe('live');
    expect(activeTask.snapshot.phase).toBe('idle');
    expect(activeTask.exports).toEqual([]);
  });

  it('creates a live session from a replay task while keeping the request', () => {
    const repository = createMockTaskRepository();
    const task = repository.listRecentTasks()[1];

    repository.loadTaskIntoWorkspace(task.id);
    repository.createTaskFromReplay();

    const activeTask = repository.getActiveTask();

    expect(activeTask.mode).toBe('live');
    expect(activeTask.request).toBe(task.request);
    expect(activeTask.snapshot.phase).toBe('idle');
    expect(activeTask.snapshot.nodes.every((node) => node.status === 'pending')).toBe(true);
  });

  it('persists current live session into recent history after export', () => {
    const repository = createMockTaskRepository();

    repository.updateActiveTask({
      name: 'inventory report',
      status: 'exported PDF',
      summary: 'inventory risk summary',
      request: 'analyze inventory',
      exports: [{ format: 'PDF', status: 'PDF done' }],
      risks: ['needs review'],
      dataSource: {
        kind: 'csv',
        fileName: 'inventory.csv',
        columnCount: 4,
        rowCount: 24,
        fieldMappings: [{ source: 'week', target: 'week' }],
      },
    });

    const savedTask = repository.saveActiveTaskToHistory();
    const detail = repository.getTaskDetail(savedTask.id);

    expect(repository.listRecentTasks()[0].name).toBe('inventory report');
    expect(detail?.exports[0].status).toBe('PDF done');
    expect(detail?.dataSource?.fileName).toBe('inventory.csv');
  });

  it('updates the same saved history record on repeated export', () => {
    const repository = createMockTaskRepository();

    repository.updateActiveTask({
      name: 'inventory report',
      exports: [{ format: 'PDF', status: 'PDF done' }],
    });

    const firstSaved = repository.saveActiveTaskToHistory();

    repository.updateActiveTask({
      status: 'exported Word',
      exports: [{ format: 'Word', status: 'Word done' }],
    });

    const secondSaved = repository.saveActiveTaskToHistory();

    expect(secondSaved.id).toBe(firstSaved.id);
    expect(repository.listRecentTasks().filter((task) => task.name === 'inventory report')).toHaveLength(1);
  });

  it('stores current workspace session as a reusable template', () => {
    const repository = createMockTaskRepository();

    repository.updateActiveTask({
      summary: 'template summary',
      request: 'template request',
    });

    const savedTemplate = repository.saveActiveTaskAsTemplate();

    expect(savedTemplate.name).toBe('template request');
    expect(savedTemplate.source).toBe('workspace');
    expect(repository.listTemplates()[0].name).toBe('template request');
  });

  it('duplicates an existing template and keeps the original', () => {
    const repository = createMockTaskRepository();
    const original = repository.listTemplates().find((template) => template.source === 'system');

    const duplicatedTemplate = repository.duplicateTemplate(original!.id);

    expect(duplicatedTemplate?.source).toBe('workspace');
    expect(repository.listTemplates().some((template) => template.id === original!.id)).toBe(true);
  });
});
