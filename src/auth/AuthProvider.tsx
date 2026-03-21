import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useContextStore } from '../state/useContextStore';
import { safeSendWithFallback } from '../utils/messaging';
import type { SubscriptionTier } from '../types/messages';

interface AuthContextValue {
  loading: boolean;
  tier: SubscriptionTier;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Fetch subscription tier from background script with automatic retry on worker sleep.
 */
async function getTierFromBackground(): Promise<SubscriptionTier> {
  const response = await safeSendWithFallback<{ tier?: SubscriptionTier }>(
    { type: 'CK_GET_SUBSCRIPTION' },
    { tier: 'free' },
    { retries: 3 }
  );

  return response?.tier === 'pro' ? 'pro' : 'free';
}

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<SubscriptionTier>('free');
  const setStoreTier = useContextStore((state) => state.setTier);

  const refresh = async () => {
    setLoading(true);
    try {
      const checkedTier = await getTierFromBackground();
      setTier(checkedTier);
      setStoreTier(checkedTier);
    } catch (error) {
      console.warn('[ContextKeeper][AuthProvider] Failed to refresh tier.', {
        error: error instanceof Error ? error.message : String(error)
      });
      setTier('free');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo(
    () => ({
      loading,
      tier,
      refresh
    }),
    [loading, tier]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return context;
}
