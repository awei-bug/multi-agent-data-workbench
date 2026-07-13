type ExecutionTimelineProps = {
  runningLabel: string | null;
  phase: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  logMessage: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onFail: () => void;
  onRetryCurrent: () => void;
  onStop: () => void;
  readOnly?: boolean;
};

function getLogTone(phase: ExecutionTimelineProps['phase']) {
  if (phase === 'failed') return 'context-block-log-warn';
  if (phase === 'running') return 'context-block-log-info';
  if (phase === 'completed') return 'context-block-log-success';
  return '';
}

function getPhaseCopy(phase: ExecutionTimelineProps['phase']) {
  if (phase === 'running') return '运行中';
  if (phase === 'paused') return '已暂停';
  if (phase === 'completed') return '已完成';
  if (phase === 'failed') return '失败';
  if (phase === 'stopped') return '已终止';
  return '未开始';
}

function ExecutionTimeline({
  runningLabel,
  phase,
  logMessage,
  onStart,
  onPause,
  onResume,
  onRetry,
  onFail,
  onRetryCurrent,
  onStop,
  readOnly = false,
}: ExecutionTimelineProps) {
  return (
    <section className="content-card workspace-section" id="execution-timeline">
      <div className="section-heading">
        <span className="section-index">05</span>
        <div>
          <h3>运行监控</h3>
          <p>用操作条推动流程，用日志卡快速判断当前阶段是否正常。</p>
        </div>
      </div>

      <div className="workflow-flow-header workflow-flow-header-enterprise">
        <div>
          <strong>{runningLabel ? `当前执行：${runningLabel}` : '当前执行：等待启动'}</strong>
          <p className="status-note">失败后可直接重试当前节点，不必整条流程重跑。</p>
        </div>
        <span
          className={`status-chip status-chip-${phase === 'completed' ? 'success' : phase === 'failed' ? 'failed' : phase === 'running' ? 'running' : 'pending'}`}
        >
          {getPhaseCopy(phase)}
        </span>
      </div>

      <div className="execution-command-grid">
        <button className="action-button" type="button" onClick={onStart} disabled={readOnly || phase === 'running'}>
          启动任务
        </button>
        <button className="action-button secondary-button" type="button" onClick={onPause} disabled={readOnly || phase !== 'running'}>
          暂停
        </button>
        <button className="action-button secondary-button" type="button" onClick={onResume} disabled={readOnly || phase !== 'paused'}>
          继续
        </button>
        <button className="action-button secondary-button" type="button" onClick={onRetry} disabled={readOnly || phase === 'idle'}>
          重试全流程
        </button>
        <button className="action-button secondary-button" type="button" onClick={onFail} disabled={readOnly || phase !== 'running'}>
          模拟失败
        </button>
        <button className="action-button secondary-button" type="button" onClick={onRetryCurrent} disabled={readOnly || phase !== 'failed'}>
          重试当前节点
        </button>
        <button className="action-button tertiary-button" type="button" onClick={onStop} disabled={readOnly || phase === 'idle'}>
          终止任务
        </button>
      </div>
      {readOnly ? <p className="status-note">当前角色为只读，无法启动或控制工作流。</p> : null}

      {phase === 'failed' ? (
        <div className="failure-callout" role="alert">
          <strong>当前节点执行失败</strong>
          <p>先检查日志和节点输入，再点击“重试当前节点”。</p>
        </div>
      ) : null}

      <div className={`log-card ${getLogTone(phase)}`}>
        <strong>运行日志</strong>
        <p>{logMessage}</p>
        <p className="status-note">
          {runningLabel
            ? `当前节点：${runningLabel}`
            : phase === 'completed'
              ? '当前节点：全部节点已完成'
              : phase === 'stopped'
                ? '当前节点：任务已终止'
                : '当前节点：等待启动'}
        </p>
      </div>
    </section>
  );
}

export default ExecutionTimeline;
