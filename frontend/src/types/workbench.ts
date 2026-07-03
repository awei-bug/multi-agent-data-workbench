import type { TaskRecord } from './tasks';

export type WorkbenchContext = {
  activeAgent: string;
  inputSummary: string;
  outputSummary: string;
  latestLog: string;
  risks: string[];
};

export type WorkbenchShellContext = {
  context: WorkbenchContext;
  setContext: (context: WorkbenchContext) => void;
  activeTask: TaskRecord;
  setActiveTask: (task: TaskRecord) => void;
};

export const defaultWorkbenchContext: WorkbenchContext = {
  activeAgent: '等待启动',
  inputSummary: '当前还没有载入任务输入。可以先加载示例数据，再填写分析需求。',
  outputSummary: '当前还没有中间产出。',
  latestLog: '系统空闲，已准备进入多 Agent 主流程。',
  risks: ['字段映射尚未校验，缺失值处理方式和时间粒度仍待确认。'],
};
