import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { X } from 'lucide-react';
import './AuthModal.css';

export default function AuthModal() {
  const { isAuthModalOpen, closeAuthModal, login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!isLogin && !trimmedName) {
      setError('Name, email, and password are required.');
      return;
    }
    if (!trimmedEmail || !password) {
      setError('Name, email, and password are required.');
      return;
    }

    setLoading(true);

    let result;
    if (isLogin) {
      result = await login(trimmedEmail, password);
    } else {
      result = await register(trimmedName, trimmedEmail, password);
    }

    setLoading(false);

    if (result.success) {
      closeAuthModal();
      // Reset form
      setName('');
      setEmail('');
      setPassword('');
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={closeAuthModal}>
      <div className="auth-modal-content" onClick={e => e.stopPropagation()}>
        <button className="auth-close-btn" onClick={closeAuthModal} aria-label="Close">
          <X size={20} />
        </button>
        
        <h2>{isLogin ? 'Login' : 'Register'}</h2>
        <p className="auth-subtitle">
          {isLogin 
            ? 'Access your account to submit field reports.' 
            : 'Create an account to submit field reports.'}
        </p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          {!isLogin && (
            <div className="form-group">
              <label htmlFor="auth-name">Full Name</label>
              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required={!isLogin}
                disabled={loading}
              />
            </div>
          )}
          
          <div className="form-group">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              disabled={loading}
              minLength={6}
            />
          </div>

          <button type="submit" className="btn btn-primary auth-submit-btn" disabled={loading}>
            {loading ? 'Processing...' : (isLogin ? 'Login' : 'Register')}
          </button>
        </form>

        <div className="auth-toggle">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button 
            type="button" 
            className="btn-link" 
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
          >
            {isLogin ? 'Register' : 'Login'}
          </button>
        </div>
        
        {!isLogin && (
          <div className="auth-notice">
            Note: New accounts are created as "citizen" by default.
          </div>
        )}
      </div>
    </div>
  );
}
