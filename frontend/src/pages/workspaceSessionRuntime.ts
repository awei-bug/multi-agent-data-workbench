import { createMockTaskEngine, type WorkflowSnapshot } from '../mock/mockTaskEngine';
import { createMockTaskRepository } from '../mock/mockTaskRepository';
import type { TaskDataSourceRecord, TaskRecord } from '../types/tasks';

type ActiveTaskUpdate = {
  name?: string;
  mode?: TaskRecord['mode'];
  status?: string;
  summary?: string;
  request?: string;
  snapshot?: WorkflowSnapshot;
  exports?: TaskRecord['exports'];
  risks?: string[];
  dataSource?: TaskDataSourceRecord;
};

type WorkspaceSessionRepository = {
  getActiveTask: () => TaskRecord;
  updateActiveTask: (update: ActiveTaskUpdate) => TaskRecord;
  resetActiveTask: () => TaskRecord;
  createTaskFromReplay: () => TaskRecord;
  saveActiveTaskToHistory: () => TaskRecord;
  saveActiveTaskAsTemplate: (draft?: { name: string; request: string; summary: string }) => unknown;
  parseIntent?: (request: string) => Promise<{
    request: string;
    goal: string;
    metrics: string;
    dimensions: string;
    charts: string;
  }>;
};

type WorkspaceSessionEngine = {
  start: () => WorkflowSnapshot;
  advance: (nodes: WorkflowSnapshot['nodes']) => WorkflowSnapshot;
  pause: (snapshot: WorkflowSnapshot) => WorkflowSnapshot;
  resume: (snapshot: WorkflowSnapshot) => WorkflowSnapshot;
  restart: () => WorkflowSnapshot;
  fail: (snapshot: WorkflowSnapshot) => WorkflowSnapshot;
  retryCurrent: (snapshot: WorkflowSnapshot) => WorkflowSnapshot;
  stop: (snapshot: WorkflowSnapshot) => WorkflowSnapshot;
};

type WorkspaceSessionRuntimeOptions = {
  repository?: WorkspaceSessionRepository;
  engine?: WorkspaceSessionEngine;
};

export function createWorkspaceSessionRuntime(options: WorkspaceSessionRuntimeOptions = {}) {
  const repository = options.repository ?? createMockTaskRepository();
  const engine = options.engine ?? createMockTaskEngine();

  return {
    getActiveTask() {
      return repository.getActiveTask();
    },
    updateActiveTask(update: ActiveTaskUpdate) {
      return repository.updateActiveTask(update);
    },
    resetActiveTask() {
      return repository.resetActiveTask();
    },
    createTaskFromReplay() {
      return repository.createTaskFromReplay();
    },
    saveActiveTaskToHistory() {
      return repository.saveActiveTaskToHistory();
    },
    saveActiveTaskAsTemplate(draft?: { name: string; request: string; summary: string }) {
      return repository.saveActiveTaskAsTemplate(draft);
    },
    parseIntent(request: string) {
      if (!repository.parseIntent) {
        return null;
      }

      return repository.parseIntent(request);
    },
    start() {
      return engine.start();
    },
    advance(nodes: WorkflowSnapshot['nodes']) {
      return engine.advance(nodes);
    },
    pause(snapshot: WorkflowSnapshot) {
      return engine.pause(snapshot);
    },
    resume(snapshot: WorkflowSnapshot) {
      return engine.resume(snapshot);
    },
    restart() {
      return engine.restart();
    },
    fail(snapshot: WorkflowSnapshot) {
      return engine.fail(snapshot);
    },
    retryCurrent(snapshot: WorkflowSnapshot) {
      return engine.retryCurrent(snapshot);
    },
    stop(snapshot: WorkflowSnapshot) {
      return engine.stop(snapshot);
    },
  };
}
