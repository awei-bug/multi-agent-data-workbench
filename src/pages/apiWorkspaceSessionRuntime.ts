import { createMockTaskEngine, type WorkflowSnapshot } from '../mock/mockTaskEngine';
import type { TaskRecord } from '../types/tasks';

type ActiveTaskUpdate = {
  name?: string;
  mode?: TaskRecord['mode'];
  status?: string;
  summary?: string;
  request?: string;
  snapshot?: WorkflowSnapshot;
  exports?: TaskRecord['exports'];
  risks?: string[];
};

type WorkspaceSessionTransport = {
  getActiveTask: () => Promise<TaskRecord>;
  updateActiveTask: (update: ActiveTaskUpdate) => Promise<TaskRecord>;
  resetActiveTask: () => Promise<TaskRecord>;
  createTaskFromReplay: () => Promise<TaskRecord>;
  saveActiveTaskToHistory: () => Promise<TaskRecord>;
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

type ApiWorkspaceSessionRuntimeOptions = {
  transport: WorkspaceSessionTransport;
  engine?: WorkspaceSessionEngine;
};

export function createApiWorkspaceSessionRuntime(options: ApiWorkspaceSessionRuntimeOptions) {
  const engine = options.engine ?? createMockTaskEngine();
  const transport = options.transport;

  return {
    getActiveTask() {
      return transport.getActiveTask();
    },
    updateActiveTask(update: ActiveTaskUpdate) {
      return transport.updateActiveTask(update);
    },
    resetActiveTask() {
      return transport.resetActiveTask();
    },
    createTaskFromReplay() {
      return transport.createTaskFromReplay();
    },
    saveActiveTaskToHistory() {
      return transport.saveActiveTaskToHistory();
    },
    parseIntent(request: string) {
      if (!transport.parseIntent) {
        throw new Error('parseIntent is not implemented');
      }

      return transport.parseIntent(request);
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

export type { ActiveTaskUpdate, WorkspaceSessionEngine, WorkspaceSessionTransport };
