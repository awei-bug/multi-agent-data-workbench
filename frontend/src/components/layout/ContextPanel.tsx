import { createMockTaskEngine } from '../../mock/mockTaskEngine';
import type { TaskRecord } from '../../types/tasks';
import type { WorkbenchContext } from '../../types/workbench';

type ContextPanelProps = {
  collapsed?: boolean;
  context: WorkbenchContext;
  activeTask: TaskRecord;
  focusedNodeId?: string | null;
  onToggle?: () => void;
};

const engine = createMockTaskEngine();

function ContextPanel({ collapsed = false, context, activeTask, focusedNodeId, onToggle }: ContextPanelProps) {
  const summaryItems = activeTask.summary
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  const dataSource = activeTask.dataSource;
  const runningNode = activeTask.snapshot.nodes.find((node) => node.status === 'running') ?? null;
  const displayNode = focusedNodeId
    ? activeTask.snapshot.nodes.find((node) => node.id === focusedNodeId) ?? runningNode
    : runningNode;
  const displayContext = displayNode ? engine.getContextForNode(displayNode.id) : activeTask.snapshot.context ?? context;

  return (
    <section
      id="context-panel"
      className={`context-panel${collapsed ? ' context-panel-collapsed' : ''}`}
      aria-label="上下文面板"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="context-panel-header">
        <h3>上下文面板</h3>
        <button className="panel-toggle-button" type="button" onClick={onToggle}>
          {collapsed ? '展开上下文面板' : '收起上下文面板'}
        </button>
      </div>
      {!collapsed ? (
        <div className="context-panel-body">
          <div className="context-block context-block-highlight">
            <span className="context-label">当前焦点</span>
            <strong>{displayNode?.label ?? activeTask.name}</strong>
            <p>{displayNode ? '上下文已联动到当前节点' : activeTask.status}</p>
            <p>{activeTask.request}</p>
          </div>
          <div className="context-block">
            <span className="context-label">任务摘要</span>
            {summaryItems.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
          {dataSource ? (
            <div className="context-block">
              <span className="context-label">数据信息</span>
              <strong>{dataSource.fileName}</strong>
              <p>{`CSV / ${dataSource.columnCount} 个字段 / ${dataSource.rowCount} 行样例`}</p>
              <ul className="context-risk-list">
                {dataSource.fieldMappings.length > 0 ? (
                  dataSource.fieldMappings.map((item) => (
                    <li key={`${item.source}-${item.target}`}>{`${item.source} -> ${item.target}`}</li>
                  ))
                ) : (
                  <li>字段映射尚未确认</li>
                )}
              </ul>
            </div>
          ) : null}
          <div className="context-block">
            <span className="context-label">导出记录</span>
            <ul className="context-risk-list">
              {activeTask.exports.length > 0 ? (
                activeTask.exports.map((item) => <li key={item.format}>{item.status}</li>)
              ) : (
                <li>暂无导出记录</li>
              )}
            </ul>
          </div>
          <div className="context-block">
            <span className="context-label">当前 Agent</span>
            <strong>{displayContext.activeAgent}</strong>
          </div>
          <div className="context-block">
            <span className="context-label">输入摘要</span>
            <p>{displayContext.inputSummary}</p>
          </div>
          <div className="context-block">
            <span className="context-label">输出摘要</span>
            <p>{displayContext.outputSummary}</p>
          </div>
          <div className="context-block context-block-log context-block-log-info">
            <span className="context-label">输出摘要</span>
            <p>{displayContext.outputSummary}</p>
          </div>
          <div className="context-block context-block-log context-block-log-success">
            <span className="context-label">最新日志</span>
            <p>{displayContext.latestLog}</p>
          </div>
          <div className="context-block context-block-log context-block-log-warn">
            <span className="context-label">风险提示</span>
            <ul className="context-risk-list">
              {displayContext.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default ContextPanel;
