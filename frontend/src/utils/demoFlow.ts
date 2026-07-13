import type { TaskDataSourceRecord, TaskRecord } from '../types/tasks';
import { createEmptyTask } from '../pages/emptyTask';
import { workspaceFetch } from './workspaceIdentity';

const DEMO_CSV = `月份,区域,渠道,订单数,销售额,毛利率,投放费用,转化率
2025-01,华东,线上商城,1260,428000,0.34,52000,0.031
2025-02,华东,线下门店,980,356000,0.31,18000,0.024
2025-03,华南,代理渠道,1120,402000,0.29,36000,0.027
2025-04,华北,线上商城,1340,468000,0.36,61000,0.033
2025-05,西南,线下门店,870,298000,0.28,15000,0.021
2025-06,华东,代理渠道,1190,441000,0.32,39000,0.028
2025-07,华南,线上商城,1410,512000,0.37,68000,0.035
2025-08,华北,线下门店,940,331000,0.30,17000,0.023
2025-09,西南,线上商城,1080,389000,0.33,45000,0.029
2025-10,华东,代理渠道,1230,456000,0.35,42000,0.030
2025-11,华南,线下门店,1010,362000,0.31,19000,0.025
2025-12,华北,线上商城,1520,548000,0.38,72000,0.036
`;

export type DemoStageId = 'prepare' | 'parse' | 'execute' | 'deliver' | 'done' | 'error';

export type DemoProgress = {
  stage: DemoStageId;
  percent: number;
  label: string;
  detail?: string;
};

export type DemoIntent = {
  request: string;
  goal: string;
  metrics: string;
  dimensions: string;
  charts: string;
};

export const DEMO_STAGES: Array<{ id: DemoStageId; label: string; percent: number }> = [
  { id: 'prepare', label: '准备示例数据', percent: 15 },
  { id: 'parse', label: '解析分析意图', percent: 40 },
  { id: 'execute', label: '启动多 Agent 执行', percent: 70 },
  { id: 'deliver', label: '进入报告交付', percent: 92 },
  { id: 'done', label: '演示完成', percent: 100 },
];

function parseCsv(text: string) {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headers = lines[0].split(',').map((item) => item.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(',').map((item) => item.trim());
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = values[index] ?? '';
      return record;
    }, {});
  });
  return { headers, rows };
}

function inferType(header: string, values: string[]) {
  if (header.includes('月') || header.toLowerCase().includes('date')) return 'date';
  if (values.every((value) => value === '' || /^-?\d+(\.\d+)?$/.test(value))) return 'number';
  return 'string';
}

export type DemoDataset = TaskDataSourceRecord & { id: string; name: string };

export function buildDemoDataset(): DemoDataset {
  const { headers, rows } = parseCsv(DEMO_CSV);
  const columns = headers.map((header) => ({
    name: header,
    type: inferType(
      header,
      rows.map((row) => row[header] ?? ''),
    ),
  }));

  return {
    id: 'demo-sales-2025',
    name: '2025经营销售样例数据.csv',
    kind: 'table',
    formatLabel: 'CSV 示例',
    fileName: '2025经营销售样例数据.csv',
    columnCount: headers.length,
    rowCount: rows.length,
    columns,
    previewRows: rows,
    analysisRows: rows,
    analysisScope: { mode: 'full', rowCount: rows.length, rowsProcessed: rows.length },
    profile: {
      nullCounts: headers.reduce<Record<string, number>>((acc, header) => {
        acc[header] = 0;
        return acc;
      }, {}),
      duplicateRows: 0,
    },
    fieldMappings: headers.map((header) => ({ source: header, target: header })),
    originalFileSize: DEMO_CSV.length,
  };
}

export function buildDemoTaskSeed() {
  const dataSource = buildDemoDataset();
  return {
    name: '2025 经营销售分析（示例演示）',
    status: '样例数据已就绪',
    summary:
      '已载入 2025 年经营销售样例数据，包含月份、区域、渠道、订单数、销售额、毛利率、投放费用、转化率，可直接解析需求并启动多 Agent 流程。',
    request: '分析 2025 年月度销售额趋势、区域差异、渠道表现和投放效率，并输出管理层报告。',
    dataSource,
    risks: ['当前为系统生成样例数据，用于演示流程和图表效果。'],
  };
}

export function buildDemoIntent(task?: TaskRecord): DemoIntent {
  return {
    request: task?.request || DEMO_REQUEST,
    goal: task?.name || '2025 经营销售分析（示例演示）',
    metrics: '销售额、订单数、毛利率、转化率',
    dimensions: '月份、区域、渠道',
    charts: '趋势折线图、区域对比柱状图',
  };
}

export function applyDemoTaskLocally(current: TaskRecord): TaskRecord {
  const seed = buildDemoTaskSeed();
  const empty = createEmptyTask();
  return {
    ...current,
    ...seed,
    id: current.id || empty.id,
    mode: 'live',
    time: current.time || empty.time,
    snapshot: {
      ...empty.snapshot,
      phase: 'idle',
      logMessage: '样例数据已就绪，等待需求确认与启动',
      nodes: empty.snapshot.nodes.map((node, index) =>
        index === 0 ? { ...node, status: 'success' as const } : { ...node, status: 'pending' as const },
      ),
      context: {
        activeAgent: '数据接入 Agent',
        inputSummary: `已载入示例数据源 ${seed.dataSource.fileName}：${seed.dataSource.rowCount} 行 / ${seed.dataSource.columnCount} 列。`,
        outputSummary: '字段映射已自动确认，可直接进入需求解析与执行。',
        latestLog: '一键演示流已准备样例数据。',
        risks: seed.risks,
      },
    },
    exports: [],
    artifacts: [],
    execution: { mode: 'async', status: 'idle' },
  };
}

function progressOf(stage: DemoStageId, detail?: string): DemoProgress {
  const found = DEMO_STAGES.find((item) => item.id === stage);
  if (stage === 'error') {
    return { stage, percent: 100, label: '演示失败', detail };
  }
  return {
    stage,
    percent: found?.percent ?? 0,
    label: found?.label ?? stage,
    detail,
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function startDemoAnalysisFlow(options: {
  apiBaseUrl: string;
  currentTask: TaskRecord;
  onProgress?: (progress: DemoProgress) => void;
}): Promise<TaskRecord> {
  const { apiBaseUrl, currentTask, onProgress } = options;
  const seed = buildDemoTaskSeed();
  onProgress?.(progressOf('prepare', '正在生成并接入示例数据…'));

  // Prefer backend persistence when available.
  if (apiBaseUrl) {
    const csvBlob = new Blob([DEMO_CSV], { type: 'text/csv;charset=utf-8' });
    const form = new FormData();
    form.append('file', csvBlob, seed.dataSource.fileName);

    let datasetId = seed.dataSource.id;
    try {
      const uploadResponse = await workspaceFetch(`${apiBaseUrl}/api/data-source/upload`, {
        method: 'POST',
        body: form,
      });
      if (uploadResponse.ok) {
        const uploaded = await uploadResponse.json();
        datasetId = String(uploaded.id || datasetId);
      }
    } catch {
      // Fall through to local seed if upload is unavailable.
    }

    try {
      if (datasetId && !datasetId.startsWith('demo-')) {
        await workspaceFetch(`${apiBaseUrl}/api/tasks/active/dataset/${encodeURIComponent(datasetId)}`, {
          method: 'POST',
        });
      }

      const patchResponse = await workspaceFetch(`${apiBaseUrl}/api/active-task`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: seed.name,
          status: seed.status,
          summary: seed.summary,
          request: seed.request,
          risks: seed.risks,
          dataSource: seed.dataSource,
        }),
      });
      if (patchResponse.ok) {
        const task = (await patchResponse.json()) as TaskRecord;
        return {
          ...task,
          name: task.name || seed.name,
          request: task.request || seed.request,
          summary: task.summary || seed.summary,
          dataSource: task.dataSource || seed.dataSource,
          status: task.status || seed.status,
          risks: task.risks?.length ? task.risks : seed.risks,
        };
      }
    } catch {
      // Local fallback below.
    }
  }

  return applyDemoTaskLocally(currentTask);
}

export async function runFullDemoFlow(options: {
  apiBaseUrl: string;
  currentTask: TaskRecord;
  autoStart?: boolean;
  pollTimeoutMs?: number;
  onProgress?: (progress: DemoProgress) => void;
  onTask?: (task: TaskRecord) => void;
}): Promise<{ task: TaskRecord; intent: DemoIntent; reachedDelivery: boolean }> {
  const {
    apiBaseUrl,
    currentTask,
    autoStart = true,
    pollTimeoutMs = 45000,
    onProgress,
    onTask,
  } = options;

  let task = await startDemoAnalysisFlow({ apiBaseUrl, currentTask, onProgress });
  onTask?.(task);

  const intent = buildDemoIntent(task);
  onProgress?.(progressOf('parse', '正在结构化解析分析需求…'));

  if (apiBaseUrl) {
    try {
      const parseResponse = await workspaceFetch(`${apiBaseUrl}/api/intent/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: intent.request, dataSource: task.dataSource }),
      });
      if (parseResponse.ok) {
        const parsed = (await parseResponse.json()) as DemoIntent;
        intent.goal = parsed.goal || intent.goal;
        intent.metrics = parsed.metrics || intent.metrics;
        intent.dimensions = parsed.dimensions || intent.dimensions;
        intent.charts = parsed.charts || intent.charts;
      }

      const patchResponse = await workspaceFetch(`${apiBaseUrl}/api/active-task`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: intent.goal,
          request: intent.request,
          intent,
          summary: `分析目标：${intent.goal}\n核心指标：${intent.metrics}\n分析维度：${intent.dimensions}`,
          status: '需求已解析，等待启动',
        }),
      });
      if (patchResponse.ok) {
        task = (await patchResponse.json()) as TaskRecord;
        onTask?.(task);
      }
    } catch {
      // Keep local intent if parse endpoints are unavailable.
    }
  } else {
    await sleep(250);
    task = {
      ...task,
      name: intent.goal,
      request: intent.request,
      intent,
      summary: `分析目标：${intent.goal}\n核心指标：${intent.metrics}\n分析维度：${intent.dimensions}`,
      status: '需求已解析，等待启动',
    };
    onTask?.(task);
  }

  if (!autoStart) {
    onProgress?.(progressOf('execute', '需求已解析，可手动启动任务'));
    return { task, intent, reachedDelivery: false };
  }

  onProgress?.(progressOf('execute', '正在启动多 Agent 异步任务…'));
  if (apiBaseUrl) {
    try {
      const startResponse = await workspaceFetch(`${apiBaseUrl}/api/workflow/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (startResponse.ok) {
        task = (await startResponse.json()) as TaskRecord;
        onTask?.(task);
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < pollTimeoutMs) {
        await sleep(700);
        const polledResponse = await workspaceFetch(`${apiBaseUrl}/api/tasks/active`);
        if (!polledResponse.ok) break;
        task = (await polledResponse.json()) as TaskRecord;
        onTask?.(task);

        const phase = String(task.snapshot?.phase || '');
        const status = String(task.execution?.status || '');
        const completedNodes = task.snapshot.nodes.filter((node) => node.status === 'success').length;
        const totalNodes = Math.max(task.snapshot.nodes.length, 1);
        const execPercent = 70 + Math.round((completedNodes / totalNodes) * 20);
        onProgress?.({
          stage: 'execute',
          percent: Math.min(90, execPercent),
          label: '启动多 Agent 执行',
          detail: task.snapshot.nodes.find((node) => node.status === 'running')?.label
            ? `当前节点：${task.snapshot.nodes.find((node) => node.status === 'running')?.label}`
            : `进度 ${completedNodes}/${totalNodes}`,
        });

        if (
          ['completed', 'needs_review', 'failed', 'stopped'].includes(phase) ||
          ['succeeded', 'failed', 'cancelled'].includes(status)
        ) {
          break;
        }
      }
    } catch {
      // Fall through with current task snapshot.
    }
  } else {
    // Local mock progression for offline demo.
    const empty = createEmptyTask();
    const nodes = empty.snapshot.nodes.map((node, index) => ({
      ...node,
      status: index < empty.snapshot.nodes.length - 1 ? ('success' as const) : ('success' as const),
    }));
    await sleep(400);
    task = {
      ...task,
      status: '已完成',
      snapshot: {
        ...task.snapshot,
        phase: 'completed',
        logMessage: '示例演示流程已完成',
        nodes,
        context: {
          ...task.snapshot.context,
          activeAgent: '审核校验 Agent',
          latestLog: '示例演示执行完成，可进入报告交付。',
          outputSummary: '已生成示例分析结论，可导出报告。',
        },
      },
      execution: { mode: 'async', status: 'succeeded', steps: nodes.length },
      artifacts: [
        {
          type: 'report_markdown',
          content: {
            markdown: `# ${intent.goal}\n\n- 指标：${intent.metrics}\n- 维度：${intent.dimensions}\n- 图表：${intent.charts}\n\n本报告由一键示例演示流自动生成。`,
          },
        },
      ],
    };
    onTask?.(task);
  }

  const phase = String(task.snapshot?.phase || '');
  const status = String(task.execution?.status || '');
  const reachedDelivery =
    ['completed', 'needs_review'].includes(phase) || status === 'succeeded' || Boolean(task.artifacts?.length);

  if (reachedDelivery) {
    onProgress?.(progressOf('deliver', '分析完成，进入报告交付…'));
    await sleep(200);
    onProgress?.(progressOf('done', '示例演示完成'));
  } else if (phase === 'failed' || status === 'failed') {
    onProgress?.(progressOf('error', '演示执行失败，可在执行页重试'));
  } else {
    onProgress?.(progressOf('execute', '任务仍在执行，可在执行页继续观察'));
  }

  return { task, intent, reachedDelivery };
}

export const DEMO_REQUEST = buildDemoTaskSeed().request;
