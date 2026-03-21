import { create } from 'zustand';
import type { SubscriptionTier } from '../types/messages';

interface ContextKeeperState {
  tokenCount: number;
  threshold: number;
  tier: SubscriptionTier;
  setTokenCount: (tokenCount: number) => void;
  setThreshold: (threshold: number) => void;
  setTier: (tier: SubscriptionTier) => void;
}

export const useContextStore = create<ContextKeeperState>((set) => ({
  tokenCount: 0,
  threshold: 8000,
  tier: 'free',
  setTokenCount: (tokenCount) => set({ tokenCount }),
  setThreshold: (threshold) => set({ threshold }),
  setTier: (tier) => set({ tier })
}));
