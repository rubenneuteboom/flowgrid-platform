(function () {
  const ACCESS_KEYS = ['accessToken', 'flowgrid_access_token'];
  const STORAGE_KEYS_TO_CLEAR = ['accessToken', 'flowgrid_access_token', 'refreshToken', 'user', 'tenant', 'oauthState'];
  const COOKIE_KEYS_TO_CLEAR = ['accessToken', 'flowgrid_access_token', 'refreshToken', 'session', 'sessionId'];

  // Prevent concurrent refresh attempts
  let _refreshPromise = null;

  function getAuthToken() {
    // Check localStorage first, then sessionStorage (Safari timing fallback)
    for (const key of ACCESS_KEYS) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return null;
  }

  function getRefreshToken() {
    return localStorage.getItem('refreshToken') || sessionStorage.getItem('refreshToken');
  }

  function storeAccessToken(token) {
    localStorage.setItem('flowgrid_access_token', token);
    sessionStorage.setItem('flowgrid_access_token', token);
  }

  function isAuthenticated() {
    return Boolean(getAuthToken());
  }

  function clearAuthState() {
    STORAGE_KEYS_TO_CLEAR.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });

    COOKIE_KEYS_TO_CLEAR.forEach((name) => {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
    });
  }

  /**
   * Attempt to refresh the access token using the stored refresh token.
   * Returns the new access token on success, null on failure.
   * Deduplicates concurrent calls (only one refresh in-flight at a time).
   */
  async function refreshAccessToken() {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return null;

      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ refreshToken }),
        });

        if (!res.ok) return null;

        const data = await res.json();
        if (data.accessToken) {
          storeAccessToken(data.accessToken);
          return data.accessToken;
        }
        return null;
      } catch (_) {
        return null;
      } finally {
        _refreshPromise = null;
      }
    })();

    return _refreshPromise;
  }

  /**
   * Install a global fetch wrapper that automatically retries 401s
   * after refreshing the access token. Call once on page load.
   */
  function installAutoRefresh() {
    const _originalFetch = window.fetch;

    window.fetch = async function (...args) {
      const response = await _originalFetch.apply(this, args);

      if (response.status !== 401) return response;

      // Don't try to refresh the refresh call itself
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/api/auth/refresh') || url.includes('/api/auth/login')) {
        return response;
      }

      // Attempt token refresh
      const newToken = await refreshAccessToken();
      if (!newToken) return response; // refresh failed — return original 401

      // Retry the original request with the new token
      const [input, init = {}] = args;
      const headers = new Headers(init.headers || {});
      headers.set('Authorization', `Bearer ${newToken}`);
      return _originalFetch.call(this, input, { ...init, headers });
    };
  }

  async function signOut(options = {}) {
    const token = getAuthToken();

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch (_) {
      // Best effort; clear local auth state regardless.
    }

    clearAuthState();

    const redirectTo = options.redirectTo || '/login.html';
    window.location.href = `${redirectTo}?signedOut=true`;
  }

  function redirectToLogin() {
    const target = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login.html?redirect=${target}`;
  }

  function injectSignOutButton(options = {}) {
    if (document.getElementById('flowgrid-signout-btn')) return;

    const button = document.createElement('button');
    button.id = 'flowgrid-signout-btn';
    button.type = 'button';
    button.textContent = options.buttonText || 'Sign out';
    button.setAttribute('aria-label', 'Sign out');

    button.style.cssText = [
      'position: fixed',
      'top: 16px',
      'right: 16px',
      'z-index: 2000',
      'padding: 0.5rem 0.9rem',
      'border-radius: 8px',
      'border: 1px solid rgba(93, 213, 192, 0.45)',
      'background: rgba(21, 43, 43, 0.95)',
      'color: #e8f5f3',
      'font-size: 0.85rem',
      'font-weight: 600',
      'cursor: pointer',
      'box-shadow: 0 4px 16px rgba(0,0,0,0.25)',
      'backdrop-filter: blur(2px)',
    ].join(';');

    button.addEventListener('mouseover', () => {
      button.style.borderColor = '#5dd5c0';
      button.style.color = '#5dd5c0';
    });
    button.addEventListener('mouseout', () => {
      button.style.borderColor = 'rgba(93, 213, 192, 0.45)';
      button.style.color = '#e8f5f3';
    });

    button.addEventListener('click', () => signOut(options));
    document.body.appendChild(button);
  }

  /**
   * Check if the current access token is expired or about to expire (within 60s).
   * If so, proactively refresh it before any API calls happen.
   */
  async function ensureFreshToken() {
    const token = getAuthToken();
    if (!token) return;

    try {
      // Decode JWT payload (no verification, just check exp)
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiresAt = payload.exp * 1000;
      const now = Date.now();

      // If token expires within 60 seconds, refresh proactively
      if (expiresAt - now < 60000) {
        await refreshAccessToken();
      }
    } catch (_) {
      // If we can't decode, try refreshing anyway
      await refreshAccessToken();
    }
  }

  function initPage(options = {}) {
    const requireAuth = options.requireAuth !== false;
    const showSignOut = options.showSignOut !== false;

    // Install auto-refresh interceptor once
    installAutoRefresh();

    // Proactively refresh token if it's about to expire
    ensureFreshToken();

    if (requireAuth && !isAuthenticated()) {
      redirectToLogin();
      return;
    }

    if (showSignOut && isAuthenticated()) {
      injectSignOutButton(options);
    }
  }

  window.FlowgridAuthUI = {
    initPage,
    signOut,
    isAuthenticated,
    getAuthToken,
    getRefreshToken,
    clearAuthState,
    refreshAccessToken,
  };
})();
