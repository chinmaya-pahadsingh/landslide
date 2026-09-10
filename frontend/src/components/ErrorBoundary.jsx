import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an unhandled rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '4rem 2rem',
          maxWidth: '600px',
          margin: '2rem auto',
          textAlign: 'center',
          background: 'rgba(15, 23, 42, 0.85)',
          borderRadius: '16px',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          backdropFilter: 'blur(12px)',
          color: '#f8fafc'
        }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#f87171', marginBottom: '0.75rem' }}>
            View Display Anomaly Detected
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
            {this.state.error?.message || 'An unexpected rendering error occurred in this view.'}
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              style={{
                padding: '0.65rem 1.4rem',
                borderRadius: '8px',
                border: 'none',
                background: '#2dd4bf',
                color: '#0f172a',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Reload Page
            </button>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/';
              }}
              style={{
                padding: '0.65rem 1.4rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'transparent',
                color: '#e2e8f0',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
