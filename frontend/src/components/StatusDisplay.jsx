import { AlertTriangle, Loader2, CheckCircle2, Info } from 'lucide-react';

export function LoadingSpinner({ message = "Loading..." }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: 'hsl(var(--text-secondary))' }}>
      <Loader2 size={32} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
      <p style={{ marginTop: '1rem', fontWeight: '500' }}>{message}</p>
      
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export function ErrorState({ title = "Error", message, onRetry }) {
  return (
    <div style={{ 
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', 
      padding: '3rem', backgroundColor: 'hsla(var(--status-crit), 0.05)', 
      border: '1px solid hsla(var(--status-crit), 0.2)', borderRadius: 'var(--radius-md)',
      color: 'hsl(var(--status-crit))'
    }}>
      <AlertTriangle size={32} />
      <h3 style={{ marginTop: '1rem', fontWeight: '600' }}>{title}</h3>
      <p style={{ marginTop: '0.5rem', textAlign: 'center', maxWidth: '400px' }}>{message}</p>
      {onRetry && (
        <button 
          onClick={onRetry}
          className="btn btn-outline" 
          style={{ marginTop: '1.5rem', borderColor: 'currentColor', color: 'currentColor' }}
        >
          Try Again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title = "No Data", message, icon: Icon = Info }) {
  return (
    <div style={{ 
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', 
      padding: '4rem 2rem', color: 'hsl(var(--text-muted))',
      border: '1px dashed hsl(var(--border-strong))', borderRadius: 'var(--radius-md)'
    }}>
      <Icon size={48} opacity={0.5} />
      <h3 style={{ marginTop: '1.5rem', fontWeight: '500', color: 'hsl(var(--text-secondary))' }}>{title}</h3>
      <p style={{ marginTop: '0.5rem', textAlign: 'center', maxWidth: '400px' }}>{message}</p>
    </div>
  );
}
