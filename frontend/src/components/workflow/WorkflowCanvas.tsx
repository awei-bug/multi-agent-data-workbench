type WorkflowNode = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'failed';
};

type WorkflowCanvasProps = {
  nodes: WorkflowNode[];
  onFocusNode?: (node: WorkflowNode | null) => void;
};

function getStatusCopy(node: WorkflowNode) {
  if (node.status === 'running') return '进行中';
  if (node.status === 'success') return '已完成';
  if (node.status === 'failed') return '失败';
  return '待执行';
}

function WorkflowCanvas({ nodes, onFocusNode }: WorkflowCanvasProps) {
  const runningNode = nodes.find((node) => node.status === 'running') ?? null;

  return (
    <section className="content-card workspace-section">
      <div className="section-heading">
        <span className="section-index">04</span>
        <div>
          <h3>Agent 任务流预览</h3>
          <p>直接查看主流程节点、当前执行位置和整体推进状态。</p>
        </div>
      </div>

      <div className="workflow-flow-header workflow-flow-header-enterprise">
        <div>
          <strong>{runningNode ? `当前执行节点：${runningNode.label}` : '当前执行节点：等待启动'}</strong>
          <p className="status-note">鼠标悬停节点时，可联动上下文面板查看该节点信息。</p>
        </div>
        <span className={`status-chip status-chip-${runningNode?.status ?? 'pending'}`}>
          {runningNode ? getStatusCopy(runningNode) : '未开始'}
        </span>
      </div>

      <div className="workflow-list workflow-list-horizontal">
        {nodes.map((node, index) => (
          <article
            key={node.id}
            className={`workflow-node workflow-node-${node.status}`}
            onMouseEnter={() => onFocusNode?.(node)}
            onFocus={() => onFocusNode?.(node)}
            onMouseLeave={() => onFocusNode?.(runningNode)}
          >
            <div className="workflow-node-copy">
              <span className="workflow-node-order">{String(index + 1).padStart(2, '0')}</span>
              <strong>{node.label}</strong>
              <p className="status-note">{getStatusCopy(node)}</p>
            </div>
            <span className={`status-chip status-chip-${node.status}`}>{getStatusCopy(node)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export default WorkflowCanvas;
