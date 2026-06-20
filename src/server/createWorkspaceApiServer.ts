import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createMockTaskRepository } from '../mock/mockTaskRepository';
import { createAgnesChatClient } from './agnesChatClient';

type WorkspaceApiServerOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
};

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJson(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = '';

    request.on('data', (chunk: Buffer | string) => {
      body += String(chunk);
    });
    request.on('end', () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

export function createWorkspaceApiServer(options: WorkspaceApiServerOptions) {
  const repository = createMockTaskRepository();
  const chatClient = createAgnesChatClient({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
  });

  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? '';
    const url = request.url ?? '';

    if (method === 'GET' && url === '/api/active-task') {
      sendJson(response, 200, repository.getActiveTask());
      return;
    }

    if (method === 'PATCH' && url === '/api/active-task') {
      const payload = await readJson(request);
      sendJson(response, 200, repository.updateActiveTask(payload));
      return;
    }

    if (method === 'POST' && url === '/api/active-task/reset') {
      sendJson(response, 200, repository.resetActiveTask());
      return;
    }

    if (method === 'POST' && url === '/api/active-task/from-replay') {
      sendJson(response, 200, repository.createTaskFromReplay());
      return;
    }

    if (method === 'POST' && url === '/api/history/save-active-task') {
      sendJson(response, 200, repository.saveActiveTaskToHistory());
      return;
    }

    if (method === 'GET' && url === '/api/history/tasks') {
      sendJson(response, 200, repository.listRecentTasks());
      return;
    }

    if (method === 'GET' && url.startsWith('/api/history/tasks/')) {
      const taskId = decodeURIComponent(url.slice('/api/history/tasks/'.length));
      sendJson(response, 200, repository.getTaskDetail(taskId));
      return;
    }

    if (method === 'GET' && url === '/api/templates') {
      sendJson(response, 200, repository.listTemplates());
      return;
    }

    if (method === 'POST' && url === '/api/intent/parse') {
      const payload = await readJson(request);
      const requestText = String(payload.request ?? '').trim();

      if (!requestText) {
        sendJson(response, 400, { message: 'request is required' });
        return;
      }

      const prompt = [
        '请把下面的数据分析需求解析成 JSON。',
        '只返回 JSON，不要 markdown。',
        '字段固定为 request, goal, metrics, dimensions, charts。',
        `需求：${requestText}`,
      ].join('\n');
      const content = await chatClient.complete(prompt);

      try {
        sendJson(response, 200, JSON.parse(content));
      } catch {
        sendJson(response, 200, {
          request: requestText,
          goal: requestText,
          metrics: '销售额',
          dimensions: '月份、区域',
          charts: '趋势图',
        });
      }
      return;
    }

    sendJson(response, 404, { message: 'Not found' });
  });
}
