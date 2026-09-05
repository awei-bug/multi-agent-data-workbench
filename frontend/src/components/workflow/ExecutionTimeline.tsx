import { useState } from 'react';

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
  if (phase === 'running') return '分析中';
  if (phase === 'paused') return '已暂停';
  if (phase === 'completed') return '已完成';
  if (phase === 'failed') return '需要处理';
  if (phase === 'stopped') return '已停止';
  return '待开始';
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
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <section className="content-card workspace-section" id="execution-timeline">
      <div className="section-heading">
          <div>
          <h3>开始分析</h3>
          <p>点一次即可自动完成。过程中可暂停、重试，完成后去查看结果。</p>
        </div>
      </div>

      <div className="workflow-flow-header workflow-flow-header-enterprise">
        <div>
          <strong>{runningLabel ? `正在处理：${runningLabel}` : '准备就绪，可以开始'}</strong>
          <p className="status-note">出问题时优先点“重试”，多数情况可以直接恢复。</p>
        </div>
        <span
          className={`status-chip status-chip-${phase === 'completed' ? 'success' : phase === 'failed' ? 'failed' : phase === 'running' ? 'running' : 'pending'}`}
        >
          {getPhaseCopy(phase)}
        </span>
      </div>

      <div className="execution-command-grid">
        <button className="action-button" type="button" onClick={onStart} disabled={readOnly || phase === 'running'}>
          开始分析
        </button>
        <button className="action-button secondary-button" type="button" onClick={onPause} disabled={readOnly || phase !== 'running'}>
          暂停
        </button>
        <button className="action-button secondary-button" type="button" onClick={onResume} disabled={readOnly || phase !== 'paused'}>
          继续
        </button>
        <button className="action-button secondary-button" type="button" onClick={onRetryCurrent} disabled={readOnly || phase !== 'failed'}>
          重试
        </button>
        <button className="action-button secondary-button" type="button" onClick={onRetry} disabled={readOnly || phase === 'idle'}>
          重新分析
        </button>
        <button className="action-button tertiary-button" type="button" onClick={onStop} disabled={readOnly || phase === 'idle'}>
          停止
        </button>
      </div>

      <div className="actions-row">
        <button className="action-button tertiary-button" type="button" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? '收起更多操作' : '更多操作'}
        </button>
      </div>
      {showAdvanced ? (
        <div className="execution-command-grid" style={{ marginTop: 8 }}>
          <button className="action-button secondary-button" type="button" onClick={onFail} disabled={readOnly || phase !== 'running'}>
            模拟失败（调试）
          </button>
        </div>
      ) : null}

      {readOnly ? <p className="status-note">当前为只读，无法开始或控制分析。</p> : null}

      {phase === 'failed' ? (
        <div className="failure-callout" role="alert">
          <strong>这一步出了点问题</strong>
          <p>先看下方说明，再点“重试”。如果一直失败，可返回上一步改一下问题描述。</p>
        </div>
      ) : null}

      <div className={`log-card ${getLogTone(phase)}`}>
        <strong>分析进度说明</strong>
        <p>{logMessage}</p>
        <p className="status-note">
          {runningLabel
            ? `当前步骤：${runningLabel}`
            : phase === 'completed'
              ? '当前步骤：全部完成'
              : phase === 'stopped'
                ? '当前步骤：已停止'
                : '当前步骤：等待开始'}
        </p>
      </div>
    </section>
  );
}

export default ExecutionTimeline;
