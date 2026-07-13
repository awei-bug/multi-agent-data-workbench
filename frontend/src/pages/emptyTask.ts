import type { TaskRecord } from '../types/tasks';
import { defaultWorkbenchContext } from '../types/workbench';

export function createEmptyTask(): TaskRecord {
  return {
    id: 'workspace-active-session',
    name: '当前工作台会话',
    mode: 'live',
    status: '等待上传文件',
    time: '刚刚',
    summary: '请上传真实文件并填写分析需求。',
    request: '',
    snapshot: {
      phase: 'idle',
      logMessage: '等待上传文件',
      nodes: [
        { id: 'source', label: '数据接入 Agent', status: 'pending' },
        { id: 'clean', label: '数据清洗 Agent', status: 'pending' },
        { id: 'metric', label: '指标计算 Agent', status: 'pending' },
        { id: 'chart', label: '可视化 Agent', status: 'pending' },
        { id: 'analysis', label: '洞察分析 Agent', status: 'pending' },
        { id: 'report', label: '报告生成 Agent', status: 'pending' },
        { id: 'audit', label: '审核校验 Agent', status: 'pending' },
      ],
      context: defaultWorkbenchContext,
    },
    exports: [],
    risks: defaultWorkbenchContext.risks,
    executionLog: [],
  };
}
