(function () {
  const ACCESS_KEYS = ['accessToken', 'flowgrid_access_token'];
  const STORAGE_KEYS_TO_CLEAR = ['accessToken', 'flowgrid_access_token', 'refreshToken', 'user', 'tenant', 'oauthState'];
  const COOKIE_KEYS_TO_CLEAR = ['accessToken', 'flowgrid_access_token', 'refreshToken', 'session', 'sessionId'];

  function getAuthToken() {
    // Check localStorage first, then sessionStorage (Safari timing fallback)
    for (const key of ACCESS_KEYS) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return null;
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

  function initPage(options = {}) {
    const requireAuth = options.requireAuth !== false;
    const showSignOut = options.showSignOut !== false;

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
    clearAuthState,
  };
})();
