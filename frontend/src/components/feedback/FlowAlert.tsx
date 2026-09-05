type FlowAlertTone = 'info' | 'success' | 'warn' | 'danger';

type FlowAlertProps = {
  title: string;
  description?: string;
  tone?: FlowAlertTone;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  primaryDisabled?: boolean;
};

function FlowAlert({
  title,
  description,
  tone = 'info',
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  primaryDisabled = false,
}: FlowAlertProps) {
  return (
    <section className={`flow-alert flow-alert-${tone}`} role="alert">
      <div className="flow-alert-copy">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {primaryLabel || secondaryLabel ? (
        <div className="flow-alert-actions">
          {primaryLabel ? (
            <button className="action-button" type="button" disabled={primaryDisabled} onClick={onPrimary}>
              {primaryLabel}
            </button>
          ) : null}
          {secondaryLabel ? (
            <button className="action-button secondary-button" type="button" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default FlowAlert;
