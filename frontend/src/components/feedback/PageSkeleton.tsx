type PageSkeletonProps = {
  title?: string;
  description?: string;
  cards?: number;
  rows?: number;
  compact?: boolean;
};

function PageSkeleton({
  title = '页面加载中',
  description = '正在准备内容，请稍候…',
  cards = 4,
  rows = 3,
  compact = false,
}: PageSkeletonProps) {
  return (
    <div className={`page-skeleton${compact ? ' page-skeleton-compact' : ''}`} role="status" aria-live="polite" aria-busy="true">
      <div className="page-skeleton-hero">
        <span className="skeleton-line skeleton-kicker" />
        <strong className="page-skeleton-title">{title}</strong>
        <p className="page-skeleton-desc">{description}</p>
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-subtitle" />
      </div>

      <div className="page-skeleton-metrics" aria-hidden="true">
        {Array.from({ length: cards }).map((_, index) => (
          <div key={`metric-${index}`} className="skeleton-card">
            <span className="skeleton-line skeleton-label" />
            <span className="skeleton-line skeleton-value" />
            <span className="skeleton-line skeleton-caption" />
          </div>
        ))}
      </div>

      <div className="page-skeleton-panel" aria-hidden="true">
        <div className="skeleton-line skeleton-section-title" />
        <div className="skeleton-line skeleton-section-sub" />
        {Array.from({ length: rows }).map((_, index) => (
          <div key={`row-${index}`} className="skeleton-row">
            <span className="skeleton-line skeleton-row-main" />
            <span className="skeleton-line skeleton-row-side" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default PageSkeleton;
