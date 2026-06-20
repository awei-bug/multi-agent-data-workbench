import type { WorkbenchContext } from '../types/workbench';

export type WorkflowNodeStatus = 'pending' | 'running' | 'success' | 'failed';

export type WorkflowNode = {
  id: string;
  label: string;
  status: WorkflowNodeStatus;
};

export type ExecutionPhase = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';

export type WorkflowSnapshot = {
  nodes: WorkflowNode[];
  phase: ExecutionPhase;
  logMessage: string;
  context: WorkbenchContext;
};

const defaultWorkflow: WorkflowNode[] = [
  { id: 'source', label: '数据接入 Agent', status: 'pending' },
  { id: 'clean', label: '数据清洗 Agent', status: 'pending' },
  { id: 'metric', label: '指标计算 Agent', status: 'pending' },
  { id: 'chart', label: '可视化 Agent', status: 'pending' },
  { id: 'analysis', label: '洞察分析 Agent', status: 'pending' },
  { id: 'report', label: '报告生成 Agent', status: 'pending' },
  { id: 'audit', label: '审核校验 Agent', status: 'pending' },
];

export const agentContextMap: Record<string, WorkbenchContext> = {
  source: {
    activeAgent: '数据接入 Agent',
    inputSummary: '已收到示例销售文件、候选字段映射和上传元信息。',
    outputSummary: '已识别月份、区域和销售额字段，准备进入清洗阶段。',
    latestLog: '样例数据已接收，正在检查字段映射和缺失值。',
    risks: ['时间字段仍需确认，否则可能按错误的月份粒度进行聚合。'],
  },
  clean: {
    activeAgent: '数据清洗 Agent',
    inputSummary: '已拿到原始预览数据、推断字段类型和缺失率概览。',
    outputSummary: '字段名称已规范化，缺失销售额已标记待确认。',
    latestLog: '正在生成清洗建议，等待字段映射确认。',
    risks: ['若直接将缺失销售额补零，未获业务确认前可能扭曲趋势判断。'],
  },
  metric: {
    activeAgent: '指标计算 Agent',
    inputSummary: '已得到带月份和区域维度的清洗后销售数据。',
    outputSummary: '已计算同比、环比和区域排名指标。',
    latestLog: '正在聚合区域月度表现指标。',
    risks: ['如果上游清洗规则变化，需要重新计算所有同比与环比结果。'],
  },
  chart: {
    activeAgent: '可视化 Agent',
    inputSummary: '已收到趋势指标、区域排名结果和建议图表类型。',
    outputSummary: '趋势图和对比图草稿已生成。',
    latestLog: '正在为看板和报告草稿准备图表。',
    risks: ['图表配色尚未锁定，导出前仍需人工确认。'],
  },
  analysis: {
    activeAgent: '洞察分析 Agent',
    inputSummary: '已拿到指标结果、图表草稿和解析后的业务意图。',
    outputSummary: '核心发现和异常解释草稿已生成。',
    latestLog: '正在总结关键变化并整理管理层可读结论。',
    risks: ['当前结论仍基于样例数据，需要在真实业务数据上复核。'],
  },
  report: {
    activeAgent: '报告生成 Agent',
    inputSummary: '已收到核心发现、图表说明和管理摘要模板。',
    outputSummary: '结构化报告草稿已生成，可进入人工编辑。',
    latestLog: '正在组装执行摘要、发现结论和风险提示。',
    risks: ['报告尚未通过审核，不应直接对外发送。'],
  },
  audit: {
    activeAgent: '审核校验 Agent',
    inputSummary: '已收到完整报告草稿、图表配置和候选导出物。',
    outputSummary: '导出前复核已完成。',
    latestLog: '正在检查图表引用、摘要措辞和导出完整性。',
    risks: ['如果图表标题被手工修改，导出前应重新校验报告引用。'],
  },
};

const stoppedContext: WorkbenchContext = {
  activeAgent: '任务已终止',
  inputSummary: '当前中间产物已保留，等待人工复核。',
  outputSummary: '流程已冻结，后续可从当前结果继续或重新启动。',
  latestLog: '任务已被人工终止，当前状态已保留。',
  risks: ['仍需人工决定是从当前草稿继续，还是整链路重新执行。'],
};

function cloneNodes(nodes: WorkflowNode[]) {
  return nodes.map((node) => ({ ...node }));
}

function createRunningWorkflow() {
  return defaultWorkflow.map((node, index) => ({
    ...node,
    status: index === 0 ? ('running' as const) : ('pending' as const),
  }));
}

function getRunningNode(nodes: WorkflowNode[]) {
  return nodes.find((node) => node.status === 'running') ?? null;
}

function getFailedNode(nodes: WorkflowNode[]) {
  return nodes.find((node) => node.status === 'failed') ?? null;
}

function getContextForNode(nodeId: string) {
  return agentContextMap[nodeId];
}

export function createMockTaskEngine() {
  return {
    createDefaultNodes() {
      return cloneNodes(defaultWorkflow);
    },
    getContextForNode,
    start(): WorkflowSnapshot {
      return {
        nodes: createRunningWorkflow(),
        phase: 'running',
        logMessage: '数据接入 Agent 执行中',
        context: agentContextMap.source,
      };
    },
    advance(nodes: WorkflowNode[]): WorkflowSnapshot {
      const runningIndex = nodes.findIndex((node) => node.status === 'running');

      if (runningIndex === -1) {
        return {
          nodes: cloneNodes(nodes),
          phase: 'completed',
          logMessage: '全部节点已完成',
          context: agentContextMap.audit,
        };
      }

      const nextNodes = nodes.map((node, index) => {
        if (index <= runningIndex) {
          return { ...node, status: 'success' as const };
        }

        if (index === runningIndex + 1) {
          return { ...node, status: 'running' as const };
        }

        return { ...node };
      });

      const nextRunningNode = getRunningNode(nextNodes);

      if (!nextRunningNode) {
        return {
          nodes: nextNodes,
          phase: 'completed',
          logMessage: '审核校验 Agent 已完成',
          context: agentContextMap.audit,
        };
      }

      return {
        nodes: nextNodes,
        phase: 'running',
        logMessage: `${nextRunningNode.label} 执行中`,
        context: getContextForNode(nextRunningNode.id),
      };
    },
    pause(snapshot: WorkflowSnapshot): WorkflowSnapshot {
      const runningNode = getRunningNode(snapshot.nodes);

      if (!runningNode) {
        return snapshot;
      }

      return {
        nodes: cloneNodes(snapshot.nodes),
        phase: 'paused',
        logMessage: `已暂停在 ${runningNode.label}`,
        context: {
          ...getContextForNode(runningNode.id),
          latestLog: `${runningNode.label} 已暂停，等待人工恢复。`,
        },
      };
    },
    resume(snapshot: WorkflowSnapshot): WorkflowSnapshot {
      const runningNode = getRunningNode(snapshot.nodes);

      if (!runningNode) {
        return snapshot;
      }

      return {
        nodes: cloneNodes(snapshot.nodes),
        phase: 'running',
        logMessage: `${runningNode.label} 执行中`,
        context: getContextForNode(runningNode.id),
      };
    },
    restart(): WorkflowSnapshot {
      return {
        ...this.start(),
        logMessage: '数据接入 Agent 已重新启动',
      };
    },
    fail(snapshot: WorkflowSnapshot): WorkflowSnapshot {
      const runningNode = getRunningNode(snapshot.nodes) ?? snapshot.nodes[0];

      return {
        nodes: snapshot.nodes.map((node) =>
          node.id === runningNode.id ? { ...node, status: 'failed' as const } : { ...node },
        ),
        phase: 'failed',
        logMessage: `${runningNode.label} 执行失败，请检查字段映射后重试。`,
        context: {
          ...getContextForNode(runningNode.id),
          latestLog: `${runningNode.label} 执行失败，等待人工介入。`,
          risks: ['当前节点已失败，继续前需要人工确认输入或字段映射。'],
        },
      };
    },
    retryCurrent(snapshot: WorkflowSnapshot): WorkflowSnapshot {
      const failedNode = getFailedNode(snapshot.nodes) ?? snapshot.nodes[0];

      return {
        nodes: snapshot.nodes.map((node) => {
          if (node.id === failedNode.id) {
            return { ...node, status: 'running' as const };
          }

          if (node.status === 'success') {
            return { ...node };
          }

          return { ...node, status: 'pending' as const };
        }),
        phase: 'running',
        logMessage: `${failedNode.label} 正在重试`,
        context: getContextForNode(failedNode.id),
      };
    },
    stop(snapshot: WorkflowSnapshot): WorkflowSnapshot {
      return {
        nodes: cloneNodes(snapshot.nodes),
        phase: 'stopped',
        logMessage: '任务已终止，中间产物已保留',
        context: stoppedContext,
      };
    },
  };
}
