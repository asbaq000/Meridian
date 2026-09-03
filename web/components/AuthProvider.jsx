'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth as authApi, tokenStore } from '@/lib/api';
import { browserTimezone } from '@/lib/time';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [providers, setProviders] = useState([]);
  const [ready, setReady] = useState(false);

  /**
   * The viewer's detected zone, resolved AFTER mount rather than during render.
   *
   * `Intl.DateTimeFormat().resolvedOptions().timeZone` answers differently on
   * the two runtimes: during SSR it reports the Node process's zone, in the
   * browser it reports the user's. Reading it while rendering therefore makes
   * the server HTML and the first client render disagree for every user who is
   * not in the server's zone - which is nearly all of them once this is
   * deployed anywhere. Both sides now start at UTC and the real zone arrives on
   * the next commit.
   */
  const [detectedTimezone, setDetectedTimezone] = useState(null);
  useEffect(() => {
    setDetectedTimezone(browserTimezone());
  }, []);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setProviders([]);
      setReady(true);
      return null;
    }
    try {
      const { user: me, providers: mine } = await authApi.me();
      setUser(me);
      setProviders(mine ?? []);
      return me;
    } catch {
      // An expired or tampered token should log you out quietly, not wedge
      // the app on an error screen.
      tokenStore.set(null);
      setUser(null);
      setProviders([]);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email, password) => {
      const { token } = await authApi.login(email, password);
      tokenStore.set(token);
      return refresh();
    },
    [refresh],
  );

  const register = useCallback(
    async (data) => {
      const { token } = await authApi.register({ timezone: browserTimezone(), ...data });
      tokenStore.set(token);
      return refresh();
    },
    [refresh],
  );

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setProviders([]);
  }, []);

  const setTimezone = useCallback(async (timezone) => {
    const { user: updated } = await authApi.updateMe({ timezone });
    setUser(updated);
    return updated;
  }, []);

  const value = useMemo(
    () => ({
      user,
      providers,
      ready,
      login,
      register,
      logout,
      refresh,
      setTimezone,
      // Everything that renders a time needs a zone; falling back to the
      // browser's keeps signed-out pages honest rather than silently UTC.
      viewerTimezone: user?.timezone ?? detectedTimezone ?? 'UTC',
      // False until the browser's zone is known, so screens can hold off
      // rendering a clock rather than briefly showing the wrong one.
      timezoneResolved: Boolean(user?.timezone || detectedTimezone),
      isAdmin: user?.role === 'admin',
      isProvider: user?.role === 'provider' || user?.role === 'admin',
    }),
    [user, providers, ready, detectedTimezone, login, register, logout, refresh, setTimezone],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
