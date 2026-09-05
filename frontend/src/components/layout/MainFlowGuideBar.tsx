import { useNavigate } from 'react-router-dom';

import type { MainFlowGuide } from '../../utils/mainFlowGuide';

type MainFlowGuideBarProps = {
  guide: MainFlowGuide;
  compact?: boolean;
};

function MainFlowGuideBar({ guide, compact = false }: MainFlowGuideBarProps) {
  const navigate = useNavigate();

  return (
    <section className={`main-flow-guide${compact ? ' main-flow-guide-compact' : ''}`} aria-label="分析进度">
      <div className="main-flow-guide-head">
        <div>
          <strong>{guide.title}</strong>
          <p>{guide.description}</p>
        </div>
        <div className="main-flow-guide-actions">
          <button className="action-button" type="button" onClick={() => navigate(guide.primaryPath)}>
            {guide.primaryLabel}
          </button>
          {guide.secondaryLabel && guide.secondaryPath ? (
            <button className="action-button secondary-button" type="button" onClick={() => navigate(guide.secondaryPath!)}>
              {guide.secondaryLabel}
            </button>
          ) : null}
        </div>
      </div>

      <ol className="main-flow-steps">
        {guide.steps.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              className={`main-flow-step${step.current ? ' current' : ''}${step.done ? ' done' : ''}`}
              onClick={() => navigate(step.path)}
            >
              <span>{step.done && !step.current ? '✓' : step.index}</span>
              <div>
                <strong>{step.label}</strong>
                <small>{step.current ? '进行中' : step.done ? '已完成' : '待完成'}</small>
              </div>
            </button>
          </li>
        ))}
      </ol>
      <p className="main-flow-tip">{guide.tip}</p>
    </section>
  );
}

export default MainFlowGuideBar;
