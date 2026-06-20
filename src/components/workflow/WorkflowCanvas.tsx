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
  if (node.status === 'running') {
    return '进行中';
  }
  if (node.status === 'success') {
    return '已完成';
  }
  if (node.status === 'failed') {
    return '失败';
  }
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
          <p>展示多 Agent 主链路和当前执行状态，用渐进色和流转线标记进度。</p>
        </div>
      </div>
      <div className="workflow-flow-header">
        <strong>{runningNode ? `当前执行节点：${runningNode.label}` : '当前执行节点：等待启动'}</strong>
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
            <div>
              <strong>{`${String(index + 1).padStart(2, '0')} ${node.label}`}</strong>
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
