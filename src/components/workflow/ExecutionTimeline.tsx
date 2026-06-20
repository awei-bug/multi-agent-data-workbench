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
};

function getLogTone(phase: ExecutionTimelineProps['phase']) {
  if (phase === 'failed') return 'context-block-log-warn';
  if (phase === 'running') return 'context-block-log-info';
  if (phase === 'completed') return 'context-block-log-success';
  return '';
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
}: ExecutionTimelineProps) {
  return (
    <section className="content-card workspace-section">
      <div className="section-heading">
        <span className="section-index">05</span>
        <div>
          <h3>运行监控</h3>
          <p>推动工作流沿 Agent 链路运行，并用不同日志状态观察当前阶段。</p>
        </div>
      </div>
      <div className="actions-row">
        <button className="action-button" type="button" onClick={onStart} disabled={phase === 'running'}>
          启动任务
        </button>
        <button className="action-button secondary-button" type="button" onClick={onPause} disabled={phase !== 'running'}>
          暂停
        </button>
        <button className="action-button secondary-button" type="button" onClick={onResume} disabled={phase !== 'paused'}>
          继续
        </button>
        <button className="action-button secondary-button" type="button" onClick={onRetry} disabled={phase === 'idle'}>
          重试
        </button>
      </div>
      <div className="actions-row">
        <button className="action-button secondary-button" type="button" onClick={onFail} disabled={phase !== 'running'}>
          模拟失败
        </button>
        <button className="action-button secondary-button" type="button" onClick={onRetryCurrent} disabled={phase !== 'failed'}>
          重试当前节点
        </button>
        <button className="action-button secondary-button" type="button" onClick={onStop} disabled={phase === 'idle'}>
          终止任务
        </button>
      </div>
      <div className={`log-card ${getLogTone(phase)}`}>
        <strong>当前日志</strong>
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
