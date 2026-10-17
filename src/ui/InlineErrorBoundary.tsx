import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  name: string;
  children: ReactNode;
  fallback?: ReactNode;
  onRecover?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class InlineErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[InlineErrorBoundary: ${this.props.name}]`, error, info);
  }

  recover = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRecover?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: '12px 16px',
          margin: '8px 0',
          borderRadius: '8px',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          color: '#fca5a5',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          fontSize: '0.85rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: '#f87171' }}>
            <Icon name="skull" size={16} /> Display recovered: {this.props.name}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
            {this.state.error?.message || 'A transient display error was intercepted.'}
          </div>
          <button
            className="btn small primary"
            style={{ alignSelf: 'flex-start', background: '#dc2626' }}
            onClick={this.recover}
          >
            Reset Panel
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

