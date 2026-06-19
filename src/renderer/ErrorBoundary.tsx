import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  errorMessage: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { errorMessage: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : '界面渲染失败。'
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[ErrorBoundary] renderer crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.errorMessage) {
      return this.props.children;
    }

    return (
      <div className="app-error-boundary">
        <div>
          <strong>界面刚刚崩了一下</strong>
          <span>{this.state.errorMessage}</span>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
