import type { CKMessage, SubscriptionTier, Handoff } from '../types/messages';

const DEFAULT_THRESHOLD = 8000;
const HANDOFF_LIBRARY_KEY = 'handoffLibrary';
const HANDOFF_QUOTA_LIMIT = 50;

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

  if (message.type === 'CK_SAVE_HANDOFF') {
    handleSaveHandoff(message, sendResponse);
    return true;
  }

  if (message.type === 'CK_GET_LIBRARY') {
    handleGetLibrary(sendResponse);
    return true;
  }

  if (message.type === 'CK_DELETE_HANDOFF') {
    handleDeleteHandoff(message, sendResponse);
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

async function getHandoffLibrary(): Promise<Handoff[]> {
  const stored = await chrome.storage.local.get([HANDOFF_LIBRARY_KEY]);
  const library = (stored[HANDOFF_LIBRARY_KEY] as Handoff[] | undefined) ?? [];
  return Array.isArray(library) ? library : [];
}

async function saveHandoffWithQuota(handoff: Handoff): Promise<void> {
  const library = await getHandoffLibrary();

  // Add new handoff
  library.push(handoff);

  // Enforce quota: if exceeds limit, remove oldest (lowest timestamp)
  if (library.length > HANDOFF_QUOTA_LIMIT) {
    library.sort((a, b) => a.timestamp - b.timestamp);
    library.shift(); // Remove oldest
  }

  await chrome.storage.local.set({ [HANDOFF_LIBRARY_KEY]: library });
}

async function deleteHandoffById(id: string): Promise<void> {
  const library = await getHandoffLibrary();
  const filtered = library.filter((h) => h.id !== id);
  await chrome.storage.local.set({ [HANDOFF_LIBRARY_KEY]: filtered });
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

function handleSaveHandoff(
  message: Extract<CKMessage, { type: 'CK_SAVE_HANDOFF' }>,
  sendResponse: (response?: unknown) => void
): void {
  void (async () => {
    try {
      await saveHandoffWithQuota(message.payload);
      sendResponse({ ok: true });
    } catch (error) {
      console.warn('[ContextKeeper][Background] Error saving handoff.', {
        error: error instanceof Error ? error.message : String(error)
      });
      sendResponse({ ok: false, reason: 'Failed to save handoff' });
    }
  })();
}

function handleGetLibrary(sendResponse: (response?: unknown) => void): void {
  void (async () => {
    try {
      const handoffs = await getHandoffLibrary();
      sendResponse({ handoffs });
    } catch (error) {
      console.warn('[ContextKeeper][Background] Error fetching handoff library.', {
        error: error instanceof Error ? error.message : String(error)
      });
      sendResponse({ handoffs: [] });
    }
  })();
}

function handleDeleteHandoff(
  message: Extract<CKMessage, { type: 'CK_DELETE_HANDOFF' }>,
  sendResponse: (response?: unknown) => void
): void {
  void (async () => {
    try {
      await deleteHandoffById(message.payload.id);
      sendResponse({ ok: true });
    } catch (error) {
      console.warn('[ContextKeeper][Background] Error deleting handoff.', {
        error: error instanceof Error ? error.message : String(error)
      });
      sendResponse({ ok: false, reason: 'Failed to delete handoff' });
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
