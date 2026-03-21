import type { CKMessage, SubscriptionTier } from '../types/messages';

const DEFAULT_THRESHOLD = 8000;

// ============================================================================
// SYNCHRONOUS MESSAGE LISTENER REGISTRATION (TOP LEVEL)
// This MUST be registered synchronously to ensure it's always available
// when the content script sends a message, even if the Service Worker
// is sleeping and needs to wake up.
// ============================================================================

chrome.runtime.onMessage.addListener((message: CKMessage, sender, sendResponse): boolean => {
  if (message.type === 'CK_CHAT_TEXT') {
    handleChatText(message, sender, sendResponse);
    return true;
  }

  if (message.type === 'CK_GET_SUBSCRIPTION') {
    handleGetSubscription(sendResponse);
    return true;
  }

  return false;
});

// ============================================================================
// HELPER FUNCTIONS (can be async without blocking listener registration)
// ============================================================================

function estimateTokenCount(text: string): number {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 0;
  }

  const chars = normalized.length;
  const words = normalized.split(' ').filter(Boolean).length;
  const punctuation = (normalized.match(/[.,!?;:()[\]{}"']/g) ?? []).length;

  return Math.max(1, Math.ceil(chars / 4) + Math.ceil(words * 0.1) + Math.ceil(punctuation * 0.2));
}

async function getTokenCache(): Promise<Record<number, number>> {
  const stored = await chrome.storage.local.get(['tokenUsageByTab']);
  return (stored.tokenUsageByTab as Record<number, number> | undefined) ?? {};
}

async function saveToken(tabId: number, tokenCount: number): Promise<void> {
  const tokenUsageByTab = await getTokenCache();
  tokenUsageByTab[tabId] = tokenCount;
  await chrome.storage.local.set({ tokenUsageByTab });
}

async function getSubscriptionTier(): Promise<SubscriptionTier> {
  const stored = await chrome.storage.local.get(['subscriptionTier']);
  return stored.subscriptionTier === 'pro' ? 'pro' : 'free';
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

function handleChatText(
  message: Extract<CKMessage, { type: 'CK_CHAT_TEXT' }>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): void {
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') {
    console.warn('[ContextKeeper][Background] CK_CHAT_TEXT: Missing or invalid tab ID.');
    sendResponse({ ok: false, reason: 'Missing tab id' });
    return;
  }

  const tokenCount = estimateTokenCount(message.payload.text ?? '');

  void (async () => {
    try {
      await saveToken(tabId, tokenCount);

      await chrome.tabs.sendMessage(tabId, {
        type: 'CK_TOKEN_UPDATED',
        payload: {
          tabId,
          tokenCount,
          threshold: DEFAULT_THRESHOLD
        }
      } as CKMessage).catch((error) => {
        console.warn('[ContextKeeper][Background] Failed to send CK_TOKEN_UPDATED to tab.', {
          tabId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    } catch (error) {
      console.warn('[ContextKeeper][Background] Error in handleChatText.', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  sendResponse({ ok: true });
}

function handleGetSubscription(sendResponse: (response?: unknown) => void): void {
  void (async () => {
    try {
      const tier = await getSubscriptionTier();
      sendResponse({ tier });
    } catch (error) {
      console.warn('[ContextKeeper][Background] Error fetching subscription tier.', {
        error: error instanceof Error ? error.message : String(error)
      });
      sendResponse({ tier: 'free' });
    }
  })();
}

// ============================================================================
// LIFECYCLE HANDLERS
// ============================================================================

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['subscriptionTier']);
  if (!stored.subscriptionTier) {
    await chrome.storage.local.set({ subscriptionTier: 'free' });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') {
    return;
  }

  void chrome.tabs.sendMessage(tabId, {
    type: 'CK_REQUEST_TEXT_REFRESH'
  } as CKMessage).catch((error) => {
    console.warn('[ContextKeeper][Background] Failed to send CK_REQUEST_TEXT_REFRESH.', {
      tabId,
      error: error instanceof Error ? error.message : String(error)
    });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const tokenUsageByTab = await getTokenCache();
    delete tokenUsageByTab[tabId];
    await chrome.storage.local.set({ tokenUsageByTab });
  })();
});
