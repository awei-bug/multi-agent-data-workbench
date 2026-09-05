type EmptyStateTone = 'info' | 'success' | 'warn' | 'danger';

type EmptyStateProps = {
  title: string;
  description?: string;
  tone?: EmptyStateTone;
  icon?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  primaryDisabled?: boolean;
  primaryHref?: string;
  secondaryHref?: string;
};

function EmptyState({
  title,
  description,
  tone = 'info',
  icon = '·',
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  primaryDisabled = false,
  primaryHref,
  secondaryHref,
}: EmptyStateProps) {
  return (
    <section className={`empty-state empty-state-${tone}`} role="status">
      <div className="empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="empty-state-copy">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {primaryLabel || secondaryLabel ? (
        <div className="empty-state-actions">
          {primaryLabel ? (
            primaryHref ? (
              <a className={`action-button${primaryDisabled ? ' is-disabled' : ''}`} href={primaryHref} aria-disabled={primaryDisabled || undefined}>
                {primaryLabel}
              </a>
            ) : (
              <button className="action-button" type="button" disabled={primaryDisabled} onClick={onPrimary}>
                {primaryLabel}
              </button>
            )
          ) : null}
          {secondaryLabel ? (
            secondaryHref ? (
              <a className="action-button secondary-button" href={secondaryHref}>
                {secondaryLabel}
              </a>
            ) : (
              <button className="action-button secondary-button" type="button" onClick={onSecondary}>
                {secondaryLabel}
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default EmptyState;
