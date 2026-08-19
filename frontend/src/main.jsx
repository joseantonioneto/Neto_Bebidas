import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('App crash:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReset = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if (window.caches) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch { /* ignora */ }
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 440, margin: '12vh auto', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h2 style={{ color: '#1a237e', margin: '8px 0' }}>Algo deu errado</h2>
          <p style={{ color: '#555' }}>O aplicativo encontrou um erro. Recarregue; se persistir, limpe o cache.</p>
          <button onClick={this.handleReload} style={{ background: '#1a237e', color: '#fff', border: 0, borderRadius: 8, padding: '12px 20px', fontSize: 16, cursor: 'pointer', width: '100%', marginTop: 8 }}>Recarregar</button>
          <button onClick={this.handleReset} style={{ background: '#fff', color: '#1a237e', border: '1px solid #1a237e', borderRadius: 8, padding: '12px 20px', fontSize: 15, cursor: 'pointer', width: '100%', marginTop: 10 }}>Limpar cache e recarregar</button>
          <pre style={{ textAlign: 'left', background: '#f5f5f5', padding: 10, borderRadius: 6, marginTop: 16, fontSize: 11, color: '#c62828', overflow: 'auto', maxHeight: 160, whiteSpace: 'pre-wrap' }}>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      reg.update().catch(() => {})
    }).catch(() => {})
  })
}
