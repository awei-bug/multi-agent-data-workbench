import type { TaskRecord } from '../types/tasks';

export type ContinuePlan = {
  code: string;
  title: string;
  desc: string;
  primaryLabel: string;
  primaryPath: string;
  secondaryLabel: string;
  secondaryPath: string;
  tone: 'warn' | 'info' | 'success' | 'danger';
};

export function buildContinuePlan(task: TaskRecord): ContinuePlan {
  const phase = String(task.snapshot?.phase || 'idle');
  const hasData = Boolean(task.dataSource);
  const hasRequest = Boolean(task.request && task.request !== '尚未填写分析需求。');
  const execStatus = String(task.execution?.status || '');

  if (!hasData) {
    return {
      code: 'P0',
      title: '先接入数据源',
      desc: '当前会话还没有可分析数据。先上传文件或导入外部连接，再进入工作台。',
      primaryLabel: '去接入数据',
      primaryPath: '/data-sources',
      secondaryLabel: '查看模板库',
      secondaryPath: '/templates',
      tone: 'warn',
    };
  }

  if (phase === 'running' || execStatus === 'running' || execStatus === 'queued') {
    return {
      code: 'P2',
      title: '继续监控执行',
      desc: '任务正在推进多 Agent 节点，建议进入执行步骤查看进度、暂停或重试。',
      primaryLabel: '进入执行监控',
      primaryPath: '/workspace?step=execution',
      secondaryLabel: '查看数据洞察',
      secondaryPath: '/chat-analysis',
      tone: 'info',
    };
  }

  if (phase === 'failed' || execStatus === 'failed') {
    return {
      code: 'P2',
      title: '处理失败节点',
      desc: '流程出现异常。进入执行步骤重试当前节点，或返回输入修正需求。',
      primaryLabel: '处理失败',
      primaryPath: '/workspace?step=execution',
      secondaryLabel: '返回输入准备',
      secondaryPath: '/workspace?step=input',
      tone: 'danger',
    };
  }

  if (phase === 'completed' || phase === 'needs_review') {
    return {
      code: 'P3',
      title: '进入报告交付',
      desc: '分析已完成，可审核结论并导出 Markdown / Word / PDF。',
      primaryLabel: '进入报告交付',
      primaryPath: '/workspace?step=output',
      secondaryLabel: '打开报告中心',
      secondaryPath: '/reports',
      tone: 'success',
    };
  }

  if (!hasRequest) {
    return {
      code: 'P1',
      title: '填写并解析需求',
      desc: '数据源已就绪。进入工作台输入步骤，把业务问题解析成结构化分析意图。',
      primaryLabel: '进入输入准备',
      primaryPath: '/workspace?step=input',
      secondaryLabel: '切换数据源',
      secondaryPath: '/data-sources',
      tone: 'info',
    };
  }

  return {
    code: 'P2',
    title: '启动分析任务',
    desc: '数据与需求已准备，可进入执行步骤启动多 Agent 工作流。',
    primaryLabel: '进入执行并启动',
    primaryPath: '/workspace?step=execution',
    secondaryLabel: '继续完善需求',
    secondaryPath: '/workspace?step=input',
    tone: 'success',
  };
}

export function resolveContinuePath(task: TaskRecord | null | undefined, fallback = '/dashboard'): string {
  if (!task) return fallback;
  return buildContinuePlan(task).primaryPath || fallback;
}
