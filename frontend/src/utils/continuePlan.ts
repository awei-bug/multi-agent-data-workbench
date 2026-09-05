import type { TaskRecord } from '../types/tasks';
import { hasMeaningfulRequest } from './workspaceStageGate';

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
  const hasRequest = hasMeaningfulRequest(task);
  const execStatus = String(task.execution?.status || '');

  if (!hasData) {
    return {
      code: '1/4',
      title: '先上传数据',
      desc: '把 Excel / CSV / PDF 传上来，就可以开始分析。',
      primaryLabel: '去上传数据',
      primaryPath: '/data-sources',
      secondaryLabel: '查看模板',
      secondaryPath: '/templates',
      tone: 'warn',
    };
  }

  if (phase === 'running' || execStatus === 'running' || execStatus === 'queued') {
    return {
      code: '3/4',
      title: '分析进行中',
      desc: '系统正在自动处理，可查看实时进度。',
      primaryLabel: '查看进度',
      primaryPath: '/workspace?step=execution',
      secondaryLabel: '查看图表',
      secondaryPath: '/chat-analysis',
      tone: 'info',
    };
  }

  if (phase === 'failed' || execStatus === 'failed') {
    return {
      code: '3/4',
      title: '分析需要处理',
      desc: '出了点问题，可以一键重试，或先改一下问题描述。',
      primaryLabel: '去处理',
      primaryPath: '/workspace?step=execution',
      secondaryLabel: '修改问题',
      secondaryPath: '/workspace?step=input',
      tone: 'danger',
    };
  }

  if (phase === 'completed' || phase === 'needs_review') {
    return {
      code: '4/4',
      title: '查看分析结果',
      desc: '结论和图表已生成，可直接导出报告。',
      primaryLabel: '查看结果',
      primaryPath: '/workspace?step=output',
      secondaryLabel: '报告列表',
      secondaryPath: '/reports',
      tone: 'success',
    };
  }

  if (!hasRequest) {
    return {
      code: '2/4',
      title: '写一句你想分析什么',
      desc: '例如：比较各区域销售额，并给出结论。',
      primaryLabel: '去填写问题',
      primaryPath: '/workspace?step=input',
      secondaryLabel: '换数据',
      secondaryPath: '/data-sources',
      tone: 'info',
    };
  }

  return {
    code: '3/4',
    title: '可以开始分析了',
    desc: '数据和问题都准备好了，点一次即可自动完成。',
    primaryLabel: '开始分析',
    primaryPath: '/workspace?step=execution',
    secondaryLabel: '再改问题',
    secondaryPath: '/workspace?step=input',
    tone: 'success',
  };
}

export function resolveContinuePath(task: TaskRecord | null | undefined, fallback = '/dashboard'): string {
  if (!task) return fallback;
  return buildContinuePlan(task).primaryPath || fallback;
}
