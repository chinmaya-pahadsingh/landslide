import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem('jwt_token') : null;
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('user_data') : null;
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    // Check local storage for token and user on mount
    try {
      const storedToken = localStorage.getItem('jwt_token');
      const storedUser = localStorage.getItem('user_data');
      
      if (storedToken && !token) {
        setToken(storedToken);
      }
      if (storedUser && !user) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {
          console.error('Failed to parse stored user data', e);
          localStorage.removeItem('user_data');
        }
      }
    } catch {}
  }, []);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password }, false);
      if (response.success && response.token) {
        setToken(response.token);
        setUser(response.user);
        
        // Note: Using localStorage makes this PWA-friendly for offline mode, 
        // but has a known XSS tradeoff. Passwords are never stored.
        localStorage.setItem('jwt_token', response.token);
        localStorage.setItem('user_data', JSON.stringify(response.user));
        return { success: true, token: response.token, user: response.user };
      }
      return { success: false, error: response.error || 'Login failed' };
    } catch (err) {
      return { success: false, error: err.message || 'Login failed' };
    }
  };

  const register = async (name, email, password) => {
    try {
      const response = await api.post('/auth/register', { name, email, password }, false);
      if (response.success) {
        // Auto login after register
        return await login(email, password);
      }
      return { success: false, error: 'Registration failed' };
    } catch (err) {
      return { success: false, error: err.message || 'Registration failed' };
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_data');
  };

  const openAuthModal = () => setIsAuthModalOpen(true);
  const closeAuthModal = () => setIsAuthModalOpen(false);

  const value = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    isAuthModalOpen,
    openAuthModal,
    closeAuthModal
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
