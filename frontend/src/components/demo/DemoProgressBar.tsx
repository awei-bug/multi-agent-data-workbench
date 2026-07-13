import type { DemoProgress, DemoStageId } from '../../utils/demoFlow';
import { DEMO_STAGES } from '../../utils/demoFlow';

type DemoProgressBarProps = {
  progress: DemoProgress | null;
  compact?: boolean;
};

const STAGE_ORDER: DemoStageId[] = ['prepare', 'parse', 'execute', 'deliver', 'done'];

function stageIndex(stage: DemoStageId) {
  if (stage === 'error') return STAGE_ORDER.length;
  return Math.max(0, STAGE_ORDER.indexOf(stage));
}

function DemoProgressBar({ progress, compact = false }: DemoProgressBarProps) {
  if (!progress) return null;
  const currentIdx = stageIndex(progress.stage);
  const failed = progress.stage === 'error';

  return (
    <section
      className={`demo-progress-bar${compact ? ' compact' : ''}${failed ? ' failed' : ''}`}
      aria-label="示例演示进度"
    >
      <div className="demo-progress-head">
        <div>
          <span className="demo-progress-kicker">DEMO FLOW</span>
          <strong>{progress.label}</strong>
          {progress.detail ? <p>{progress.detail}</p> : null}
        </div>
        <em>{Math.round(progress.percent)}%</em>
      </div>
      <div className="demo-progress-track" aria-hidden="true">
        <i style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }} />
      </div>
      <div className="demo-progress-steps">
        {DEMO_STAGES.filter((item) => item.id !== 'done').map((item, index) => {
          const done = currentIdx > index || progress.stage === 'done';
          const active = STAGE_ORDER[currentIdx] === item.id;
          return (
            <div
              key={item.id}
              className={`demo-progress-step${done ? ' done' : ''}${active ? ' active' : ''}`}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <small>{item.label}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default DemoProgressBar;
