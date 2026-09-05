import { Component, type ErrorInfo, type ReactNode } from 'react';

import ChartBoardImpl from './ChartBoard';
import type { TaskArtifactRecord, TaskDataSourceRecord } from '../../types/tasks';

type ChartBoardProps = {
  dataSource?: TaskDataSourceRecord;
  metricArtifact?: TaskArtifactRecord;
  chartArtifact?: TaskArtifactRecord;
  onTitleChange: (title: string) => void;
};

type ChartErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class ChartErrorBoundary extends Component<{ children: ReactNode }, ChartErrorBoundaryState> {
  state: ChartErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ChartErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || '图表组件渲染失败',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ChartBoard render failed', error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="content-card workspace-section" role="alert">
          <div className="section-heading">
            <span className="section-index">CH</span>
            <div>
              <h3>图表暂时无法显示</h3>
              <p>{this.state.message}</p>
            </div>
          </div>
          <div className="actions-row">
            <button className="action-button" type="button" onClick={this.handleRetry}>
              重试图表
            </button>
            <button className="action-button secondary-button" type="button" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

/**
 * Stable chart entry.
 * Previously this used React.lazy() and a failed dynamic import would take down the whole analysis page.
 * Keep a local boundary so chart failures stay contained.
 */
function ChartBoard(props: ChartBoardProps) {
  return (
    <ChartErrorBoundary>
      <ChartBoardImpl {...props} />
    </ChartErrorBoundary>
  );
}

export default ChartBoard;
