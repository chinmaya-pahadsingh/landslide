import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

// Mock api service
vi.mock('../services/api', () => ({
  api: {
    post: vi.fn(),
  },
}));

// Test component to access context
const TestComponent = () => {
  const { user, token, login, logout, register } = useAuth();
  
  return (
    <div>
      <div data-testid="user-status">{user ? user.role : 'logged_out'}</div>
      <div data-testid="token-status">{token || 'no_token'}</div>
      <button onClick={() => login('test@example.com', 'password123')} data-testid="login-btn">Login</button>
      <button onClick={() => register('Test User', 'test@example.com', 'password123')} data-testid="register-btn">Register</button>
      <button onClick={logout} data-testid="logout-btn">Logout</button>
    </div>
  );
};

describe('AuthContext Security and Logic', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('unauthenticated initial state', () => {
    const { getByTestId } = render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );
    expect(getByTestId('user-status').textContent).toBe('logged_out');
    expect(getByTestId('token-status').textContent).toBe('no_token');
  });

  it('successful login updates authenticated state and localStorage', async () => {
    api.post.mockResolvedValueOnce({
      success: true,
      token: 'fake_jwt_token',
      user: { role: 'citizen', email: 'test@example.com' }
    });

    const { getByTestId } = render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    act(() => {
      getByTestId('login-btn').click();
    });

    await waitFor(() => {
      expect(getByTestId('user-status').textContent).toBe('citizen');
      expect(getByTestId('token-status').textContent).toBe('fake_jwt_token');
    });

    expect(localStorage.getItem('jwt_token')).toBe('fake_jwt_token');
  });

  it('logout clears authentication state', async () => {
    // Start with logged in state via localStorage
    localStorage.setItem('jwt_token', 'initial_token');
    localStorage.setItem('user_data', JSON.stringify({ role: 'citizen' }));

    const { getByTestId } = render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );
    
    // Ensure initialized as logged in
    await waitFor(() => {
      expect(getByTestId('user-status').textContent).toBe('citizen');
    });

    // Click logout
    act(() => {
      getByTestId('logout-btn').click();
    });

    expect(getByTestId('user-status').textContent).toBe('logged_out');
    expect(localStorage.getItem('jwt_token')).toBeNull();
  });

  it('registration flow prevents role escalation', async () => {
    // The register function in AuthContext doesn't even accept role
    // We verify the API call made by register does not include a role parameter
    api.post.mockResolvedValueOnce({ success: true });
    // It cascades into login internally:
    api.post.mockResolvedValueOnce({
      success: true,
      token: 'citizen_token',
      user: { role: 'citizen' }
    });

    const { getByTestId } = render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    act(() => {
      getByTestId('register-btn').click();
    });

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/register', {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      }, false);
    });
    
    // Notice that no `role: 'admin'` is passed. The context prevents UI role escalation inherently.
  });

  it('registration surfaces backend error message (duplicate email)', async () => {
    api.post.mockRejectedValueOnce(new Error('Email is already registered.'));

    let registerResult;
    const ErrorTestComponent = () => {
      const { register } = useAuth();
      return (
        <button
          onClick={async () => {
            registerResult = await register('Test User', 'dup@example.com', 'password123');
          }}
          data-testid="dup-register-btn"
        >
          Register
        </button>
      );
    };

    const { getByTestId } = render(
      <AuthProvider>
        <ErrorTestComponent />
      </AuthProvider>
    );

    act(() => {
      getByTestId('dup-register-btn').click();
    });

    await waitFor(() => {
      expect(registerResult).toBeDefined();
    });

    expect(registerResult.success).toBe(false);
    expect(registerResult.error).toBe('Email is already registered.');
  });

  it('login surfaces backend error message on invalid credentials', async () => {
    api.post.mockRejectedValueOnce(new Error('Invalid email or password.'));

    let loginResult;
    const LoginErrorComponent = () => {
      const { login } = useAuth();
      return (
        <button
          onClick={async () => {
            loginResult = await login('test@example.com', 'wrongpassword');
          }}
          data-testid="bad-login-btn"
        >
          Login
        </button>
      );
    };

    const { getByTestId } = render(
      <AuthProvider>
        <LoginErrorComponent />
      </AuthProvider>
    );

    act(() => {
      getByTestId('bad-login-btn').click();
    });

    await waitFor(() => {
      expect(loginResult).toBeDefined();
    });

    expect(loginResult.success).toBe(false);
    expect(loginResult.error).toBe('Invalid email or password.');
  });

  it('restores authentication state from localStorage on mount (page refresh simulation)', () => {
    localStorage.setItem('jwt_token', 'persisted_jwt_token_123');
    localStorage.setItem('user_data', JSON.stringify({
      id: 'user_123',
      name: 'Persisted User',
      email: 'persisted@test.com',
      role: 'citizen'
    }));

    const { getByTestId } = render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(getByTestId('user-status').textContent).toBe('citizen');
    expect(getByTestId('token-status').textContent).toBe('persisted_jwt_token_123');
  });
});
