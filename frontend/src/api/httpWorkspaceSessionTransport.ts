import type { ActiveTaskUpdate } from '../pages/apiWorkspaceSessionRuntime';
import type { TaskRecord } from '../types/tasks';

type HttpWorkspaceSessionTransportOptions = {
  baseUrl?: string;
};

async function readJson<T>(response: Response) {
  if (!response.ok) {
    throw new Error(`Workspace API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function createHttpWorkspaceSessionTransport(options: HttpWorkspaceSessionTransportOptions = {}) {
  const baseUrl = options.baseUrl ?? '';

  return {
    async getActiveTask() {
      const response = await fetch(`${baseUrl}/api/active-task`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      return readJson<TaskRecord>(response);
    },
    async updateActiveTask(update: ActiveTaskUpdate) {
      const response = await fetch(`${baseUrl}/api/active-task`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });

      return readJson<TaskRecord>(response);
    },
    async resetActiveTask() {
      const response = await fetch(`${baseUrl}/api/active-task/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      return readJson<TaskRecord>(response);
    },
    async createTaskFromReplay() {
      const response = await fetch(`${baseUrl}/api/active-task/from-replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      return readJson<TaskRecord>(response);
    },
    async saveActiveTaskToHistory() {
      const response = await fetch(`${baseUrl}/api/history/save-active-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      return readJson<TaskRecord>(response);
    },
    async saveActiveTaskAsTemplate(draft: { name: string; request: string; summary: string }) {
      const response = await fetch(`${baseUrl}/api/templates/save-active-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });

      return readJson<Record<string, unknown>>(response);
    },
    async workflowAction(action: string) {
      const response = await fetch(`${baseUrl}/api/workflow/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      return readJson<TaskRecord>(response);
    },
    async advanceWorkflow() {
      const response = await fetch(`${baseUrl}/api/workflow/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      return readJson<TaskRecord>(response);
    },
  };
}
