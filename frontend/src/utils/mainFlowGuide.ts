import type { TaskRecord } from '../types/tasks';
import { hasMeaningfulRequest } from './workspaceStageGate';

export type MainFlowStepId = 'data' | 'question' | 'run' | 'result';

export type MainFlowStep = {
  id: MainFlowStepId;
  index: number;
  label: string;
  short: string;
  done: boolean;
  current: boolean;
  path: string;
};

export type MainFlowGuide = {
  steps: MainFlowStep[];
  currentStep: MainFlowStep;
  progressPercent: number;
  title: string;
  description: string;
  primaryLabel: string;
  primaryPath: string;
  secondaryLabel?: string;
  secondaryPath?: string;
  tip: string;
};

function phaseOf(task: TaskRecord) {
  return String(task.snapshot?.phase || 'idle');
}

function execStatus(task: TaskRecord) {
  return String(task.execution?.status || '');
}

export function buildMainFlowGuide(task: TaskRecord): MainFlowGuide {
  const hasData = Boolean(task.dataSource);
  const hasQuestion = hasMeaningfulRequest(task);
  const phase = phaseOf(task);
  const running = phase === 'running' || execStatus(task) === 'running' || execStatus(task) === 'queued';
  const failed = phase === 'failed' || execStatus(task) === 'failed';
  const completed = phase === 'completed' || phase === 'needs_review';
  const stopped = phase === 'stopped';

  const dataDone = hasData;
  const questionDone = hasData && hasQuestion;
  const runCompleted = completed || stopped;
  const resultDone = completed && (task.exports?.length ?? 0) > 0;

  let currentId: MainFlowStepId = 'data';
  if (!hasData) currentId = 'data';
  else if (!hasQuestion) currentId = 'question';
  else if (!(runCompleted && !failed && !running)) currentId = 'run';
  else currentId = 'result';

  const steps: MainFlowStep[] = [
    {
      id: 'data',
      index: 1,
      label: '上传数据',
      short: '数据',
      done: dataDone,
      current: currentId === 'data',
      path: '/data-sources',
    },
    {
      id: 'question',
      index: 2,
      label: '说明问题',
      short: '问题',
      done: questionDone,
      current: currentId === 'question',
      path: '/workspace?step=input',
    },
    {
      id: 'run',
      index: 3,
      label: '开始分析',
      short: '分析',
      done: runCompleted && !failed,
      current: currentId === 'run',
      path: '/workspace?step=execution',
    },
    {
      id: 'result',
      index: 4,
      label: '查看结果',
      short: '结果',
      done: resultDone || completed,
      current: currentId === 'result',
      path: '/workspace?step=output',
    },
  ];

  const currentStep = steps.find((item) => item.current) ?? steps[0];
  const doneCount = steps.filter((item) => item.done).length;
  const progressPercent = Math.round((doneCount / steps.length) * 100);

  if (!hasData) {
    return {
      steps,
      currentStep,
      progressPercent,
      title: '第一步：上传你的数据',
      description: '支持 Excel / CSV / PDF 等文件。上传后系统会自动帮你进入下一步。',
      primaryLabel: '去上传数据',
      primaryPath: '/data-sources',
      secondaryLabel: '先看示例演示',
      secondaryPath: '/data-sources?demo=1',
      tip: '不会写公式也没关系，先把表格传上来就行。',
    };
  }

  if (!hasQuestion) {
    return {
      steps,
      currentStep,
      progressPercent,
      title: '第二步：用一句话说你想分析什么',
      description: `已接入「${task.dataSource?.fileName}」。例如：比较各区域销售额，并找出异常。`,
      primaryLabel: '去填写问题',
      primaryPath: '/workspace?step=input',
      secondaryLabel: '换一份数据',
      secondaryPath: '/data-sources',
      tip: '写得越具体，结果越好。不用使用专业术语。',
    };
  }

  if (running) {
    return {
      steps,
      currentStep,
      progressPercent: Math.max(progressPercent, 60),
      title: '第三步：正在自动分析',
      description: '系统正在清洗数据、计算指标并生成图表，通常只需要一会儿。',
      primaryLabel: '查看分析进度',
      primaryPath: '/workspace?step=execution',
      tip: '可以先不要离开，完成后会提示你查看结果。',
    };
  }

  if (failed) {
    return {
      steps,
      currentStep,
      progressPercent,
      title: '分析遇到问题，可以一键重试',
      description: '不用担心，常见原因是数据字段不完整。可重试，或先改一下问题描述。',
      primaryLabel: '去处理问题',
      primaryPath: '/workspace?step=execution',
      secondaryLabel: '修改分析问题',
      secondaryPath: '/workspace?step=input',
      tip: '优先点“重试”，多数情况可以直接恢复。',
    };
  }

  if (!runCompleted) {
    return {
      steps,
      currentStep,
      progressPercent,
      title: '第三步：开始自动分析',
      description: '数据和分析问题都准备好了。点一次开始，系统会自动完成后续步骤。',
      primaryLabel: '开始分析',
      primaryPath: '/workspace?step=execution',
      secondaryLabel: '再改改问题',
      secondaryPath: '/workspace?step=input',
      tip: '全过程自动跑，你只需最后看结果。',
    };
  }

  return {
    steps,
    currentStep,
    progressPercent: Math.max(progressPercent, 90),
    title: '第四步：查看结论并导出',
    description: '分析已完成。你可以阅读摘要、调整报告，并导出 Word / PDF。',
    primaryLabel: '查看分析结果',
    primaryPath: '/workspace?step=output',
    secondaryLabel: '打开报告列表',
    secondaryPath: '/reports',
    tip: '导出前可先改几句结论，让报告更贴合你的业务。',
  };
}
