import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#333', color: '#fff', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h1 style={{ color: '#ff5555' }}>App Crashed!</h1>
          <p>{this.state.error?.toString()}</p>
          <pre style={{ background: '#000', padding: '10px', overflowX: 'auto' }}>
            {this.state.info?.componentStack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ padding: '10px', marginTop: '20px' }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
