import { createMockTaskEngine, type WorkflowSnapshot } from './mockTaskEngine';
import type { ExecutionLogRecord, TaskDataSourceRecord, TaskRecord } from '../types/tasks';
import { defaultWorkbenchContext } from '../types/workbench';

const engine = createMockTaskEngine();

export type TemplateRecord = {
  id: string;
  name: string;
  tag: string;
  description: string;
  request: string;
  summary: string;
  source: 'system' | 'workspace';
};

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
  executionLog?: ExecutionLogRecord[];
};

type TemplateDraft = {
  name: string;
  request: string;
  summary: string;
};

function createExecutionLogEntry(kind: ExecutionLogRecord['kind'], message: string): ExecutionLogRecord {
  return {
    at: 'now',
    kind,
    message,
  };
}

function createIdleSnapshot(): WorkflowSnapshot {
  return {
    nodes: engine.createDefaultNodes(),
    phase: 'idle',
    logMessage: '等待启动',
    context: defaultWorkbenchContext,
  };
}

function cloneSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      risks: [...snapshot.context.risks],
    },
    nodes: snapshot.nodes.map((node) => ({ ...node })),
  };
}

function cloneExecutionLog(executionLog: ExecutionLogRecord[] | undefined) {
  return executionLog ? executionLog.map((item) => ({ ...item })) : undefined;
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    exports: task.exports.map((item) => ({ ...item })),
    risks: [...task.risks],
    snapshot: cloneSnapshot(task.snapshot),
    executionLog: cloneExecutionLog(task.executionLog),
    dataSource: task.dataSource
      ? {
          ...task.dataSource,
          columns: task.dataSource.columns?.map((item) => ({ ...item })),
          fieldMappings: task.dataSource.fieldMappings.map((item) => ({ ...item })),
          validationIssues: task.dataSource.validationIssues ? [...task.dataSource.validationIssues] : undefined,
        }
      : undefined,
  };
}

function cloneTemplate(template: TemplateRecord): TemplateRecord {
  return { ...template };
}

function createCompletedSnapshot() {
  let snapshot = engine.start();

  while (snapshot.phase === 'running') {
    snapshot = engine.advance(snapshot.nodes);
  }

  return snapshot;
}

function createRunningInsightSnapshot() {
  let snapshot = engine.start();

  for (let step = 0; step < 4; step += 1) {
    snapshot = engine.advance(snapshot.nodes);
  }

  return snapshot;
}

function createDefaultExecutionLog() {
  return [createExecutionLogEntry('system', '任务已初始化')];
}

const initialRecentTasks: TaskRecord[] = [
  {
    id: 'east-china-sales-report',
    name: '华东销售月报',
    mode: 'live',
    status: '已导出 Word / PDF',
    time: '今天 14:20',
    summary: '已复用销售分析流程，生成趋势图、异常说明和管理摘要。',
    request: '分析 2025 年月度销售趋势并准备管理报告。',
    snapshot: createCompletedSnapshot(),
    exports: [
      { format: 'Markdown', status: 'Markdown 导出完成' },
      { format: 'Word', status: 'Word 导出完成' },
      { format: 'PDF', status: 'PDF 导出完成' },
    ],
    risks: ['缺失销售额已按确认规则补齐，后续复跑需保持同样处理方式。'],
    executionLog: [
      createExecutionLogEntry('system', '任务已初始化'),
      createExecutionLogEntry('action', '启动'),
      createExecutionLogEntry('advance', '流程推进到审核校验'),
      createExecutionLogEntry('export', 'PDF 导出完成'),
    ],
  },
  {
    id: 'channel-roi-review',
    name: '渠道投放复盘',
    mode: 'live',
    status: '等待人工复核',
    time: '今天 11:05',
    summary: '数据清洗和归因拆解已完成，六月渠道说明仍待补充后再复核。',
    request: '复盘渠道 ROI 波动并整理周会材料。',
    snapshot: createRunningInsightSnapshot(),
    exports: [{ format: 'Markdown', status: 'Markdown 草稿已生成' }],
    risks: ['六月渠道说明尚未补齐，归因结论当前还不够稳定。'],
    executionLog: [
      createExecutionLogEntry('system', '任务已初始化'),
      createExecutionLogEntry('action', '启动'),
      createExecutionLogEntry('advance', '流程推进到洞察分析'),
    ],
  },
];

const initialTemplates: TemplateRecord[] = [
  {
    id: 'template-business-retro',
    name: '经营复盘模板',
    tag: '推荐',
    description: '适合月度经营复盘、管理层摘要和标准化汇报场景。',
    request: '分析 2025 年月度销售趋势并准备管理报告。',
    summary: '复用经营复盘模板，加载示例数据，解析需求并启动多 Agent 主流程。',
    source: 'system',
  },
  {
    id: 'template-anomaly-retro',
    name: '异常波动排查模板',
    tag: '排障',
    description: '适合排查指标异常、整理归因说明并沉淀风险项。',
    request: '复盘渠道 ROI 波动并整理周会材料。',
    summary: '复用异常波动排查模板，加载示例数据后逐步追踪异常变化路径。',
    source: 'system',
  },
];

function createDefaultActiveTask(request = '尚未填写分析需求。'): TaskRecord {
  return {
    id: 'workspace-active-session',
    name: '当前工作台会话',
    mode: 'live',
    status: '等待启动',
    time: '今天 15:00',
    summary: '当前会话尚未开始，请先加载数据并填写需求。',
    request,
    snapshot: createIdleSnapshot(),
    exports: [],
    risks: [...defaultWorkbenchContext.risks],
    executionLog: createDefaultExecutionLog(),
  };
}

function appendExecutionLog(task: TaskRecord, kind: ExecutionLogRecord['kind'], message: string): TaskRecord {
  return {
    ...task,
    executionLog: [...(task.executionLog ?? createDefaultExecutionLog()), createExecutionLogEntry(kind, message)],
  };
}

function hasExecutionMessage(task: TaskRecord, kind: ExecutionLogRecord['kind'], message: string) {
  return (task.executionLog ?? []).some((item) => item.kind === kind && item.message === message);
}

let recentTasks: TaskRecord[] = initialRecentTasks.map(cloneTask);
let templates: TemplateRecord[] = initialTemplates.map(cloneTemplate);
let activeTask: TaskRecord = createDefaultActiveTask();
let savedTaskCounter = 1;
let activeTaskHistoryId: string | null = null;
let savedTemplateCounter = 1;

export function createMockTaskRepository() {
  return {
    listRecentTasks() {
      return recentTasks.map(cloneTask);
    },
    getTaskDetail(taskId: string) {
      const task = recentTasks.find((item) => item.id === taskId);
      return task ? cloneTask(task) : null;
    },
    listTemplates() {
      return templates.map(cloneTemplate);
    },
    getActiveTask() {
      return cloneTask(activeTask);
    },
    updateActiveTask(update: ActiveTaskUpdate) {
      const previousTask = activeTask;
      activeTask = {
        ...activeTask,
        ...update,
        exports: update.exports ? update.exports.map((item) => ({ ...item })) : activeTask.exports,
        risks: update.risks ? [...update.risks] : activeTask.risks,
        snapshot: update.snapshot ? cloneSnapshot(update.snapshot) : activeTask.snapshot,
        executionLog: update.executionLog ? cloneExecutionLog(update.executionLog) : activeTask.executionLog,
      };

      if (
        update.snapshot?.phase === 'running' &&
        previousTask.snapshot.phase === 'idle' &&
        !hasExecutionMessage(activeTask, 'action', '启动')
      ) {
        activeTask = appendExecutionLog(activeTask, 'action', '启动');
      }

      if (update.snapshot?.phase === 'completed' || update.snapshot?.phase === 'failed' || update.snapshot?.phase === 'stopped') {
        activeTask = appendExecutionLog(activeTask, 'advance', update.snapshot.logMessage);
      }

      if (update.exports?.[0]?.status && !hasExecutionMessage(activeTask, 'export', update.exports[0].status)) {
        activeTask = appendExecutionLog(activeTask, 'export', update.exports[0].status);
      }

      return cloneTask(activeTask);
    },
    resetActiveTask() {
      activeTask = createDefaultActiveTask();
      activeTaskHistoryId = null;

      return cloneTask(activeTask);
    },
    loadTaskIntoWorkspace(taskId: string) {
      const task = recentTasks.find((item) => item.id === taskId);

      if (!task) {
        return null;
      }

      activeTask = {
        ...activeTask,
        name: task.name,
        mode: 'replay',
        status: `回放模式 - ${task.status}`,
        summary: task.summary,
        request: task.request,
        exports: task.exports.map((item) => ({ ...item })),
        risks: [...task.risks],
        snapshot: cloneSnapshot(task.snapshot),
        executionLog: cloneExecutionLog(task.executionLog),
      };
      activeTaskHistoryId = null;

      return cloneTask(activeTask);
    },
    createTaskFromReplay() {
      const previousName = activeTask.name;

      activeTask = {
        ...createDefaultActiveTask(activeTask.request),
        name: `回放新任务：${previousName}`,
        summary: `沿用 ${previousName} 的上下文，重新发起一条新的多 Agent 流程。`,
        executionLog: [
          createExecutionLogEntry('system', '任务已初始化'),
          createExecutionLogEntry('action', '基于回放新建'),
        ],
      };
      activeTaskHistoryId = null;

      return cloneTask(activeTask);
    },
    createTaskFromTemplate(template: TemplateDraft) {
      activeTask = {
        ...createDefaultActiveTask(template.request),
        name: template.name,
        summary: template.summary,
      };
      activeTaskHistoryId = null;

      return cloneTask(activeTask);
    },
    saveActiveTaskToHistory() {
      const savedId = activeTaskHistoryId ?? `saved-session-${savedTaskCounter}`;
      let savedTask: TaskRecord = {
        ...cloneTask(activeTask),
        id: savedId,
        time: `今天 16:${String(savedTaskCounter).padStart(2, '0')}`,
      };

      if (savedTask.exports[0]?.status) {
        savedTask = appendExecutionLog(savedTask, 'export', savedTask.exports[0].status);
      }

      if (!activeTaskHistoryId) {
        savedTaskCounter += 1;
      }

      activeTaskHistoryId = savedId;
      recentTasks = [savedTask, ...recentTasks.filter((task) => task.id !== savedTask.id)];

      return cloneTask(savedTask);
    },
    saveActiveTaskAsTemplate(draft?: TemplateDraft) {
      const request = draft?.request ?? activeTask.request;
      const summary = draft?.summary ?? activeTask.summary;
      const name = draft?.name ?? request;
      const template: TemplateRecord = {
        id: `workspace-template-${savedTemplateCounter}`,
        name,
        tag: '来自工作台',
        description: summary.split('\n')[0] || '从当前工作台会话沉淀出的可复用模板。',
        request,
        summary,
        source: 'workspace',
      };

      savedTemplateCounter += 1;
      templates = [template, ...templates.filter((item) => item.name !== template.name)];

      return cloneTemplate(template);
    },
    async parseIntent(request: string) {
      return {
        request,
        goal: '模拟意图摘要',
        metrics: '销售额',
        dimensions: '月份、区域',
        charts: '趋势图',
      };
    },
    duplicateTemplate(templateId: string) {
      const target = templates.find((item) => item.id === templateId);

      if (!target) {
        return null;
      }

      const duplicatedTemplate: TemplateRecord = {
        ...cloneTemplate(target),
        id: `template-duplicate-${savedTemplateCounter}`,
        name: `${target.name} 副本`,
        tag: '已复制',
        description: `复制自 ${target.name}，可继续调整后复用到新流程。`,
        source: 'workspace',
      };

      savedTemplateCounter += 1;
      templates = [duplicatedTemplate, ...templates];

      return cloneTemplate(duplicatedTemplate);
    },
  };
}
