import { Component, type ErrorInfo, type ReactNode } from 'react';

type RouteErrorBoundaryProps = {
  children: ReactNode;
  fallbackTitle?: string;
};

type RouteErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || '页面渲染出现异常',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route render failed', error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <section className="route-error-card" role="alert">
        <span className="route-error-kicker">页面异常</span>
        <h3>{this.props.fallbackTitle || '当前页面暂时无法显示'}</h3>
        <p>{this.state.message || '请重试加载，或返回总览继续分析流程。'}</p>
        <div className="actions-row">
          <button className="action-button" type="button" onClick={this.handleRetry}>
            重新加载组件
          </button>
          <button className="action-button secondary-button" type="button" onClick={this.handleReload}>
            刷新浏览器
          </button>
          <a className="action-button secondary-button" href="/dashboard">
            返回总览
          </a>
        </div>
      </section>
    );
  }
}

export default RouteErrorBoundary;
