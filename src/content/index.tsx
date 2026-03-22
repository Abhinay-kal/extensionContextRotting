import { createRoot } from 'react-dom/client';
import styles from '../styles/tailwind.css?inline';
import { App } from './App';
import { getStrategyForHost } from '../strategies/getStrategyForHost';
import { useContextStore } from '../state/useContextStore';
import { safeSendMessage } from '../utils/messaging';
import type { CKMessage } from '../types/messages';

const PENDING_HANDOFF_KEY = 'pendingHandoffCache';

function getInputSelectorsForHost(hostname: string): string[] {
  if (hostname.includes('chatgpt.com')) {
    return ['#prompt-textarea', 'textarea[data-id="root"]'];
  }

  if (hostname.includes('gemini.google.com')) {
    return [
      'rich-textarea > div[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]'
    ];
  }

  return ['textarea', '[contenteditable="true"]'];
}

function installUrlObserver(onUrlChange: () => void): () => void {
  const emit = (): void => onUrlChange();

  const wrapHistoryMethod = (method: 'pushState' | 'replaceState'): (() => void) => {
    const original = history[method];

    history[method] = function patchedHistoryMethod(...args: Parameters<History['pushState']>) {
      const result = original.apply(history, args);
      emit();
      return result;
    } as History['pushState'];

    return () => {
      history[method] = original;
    };
  };

  const restorePushState = wrapHistoryMethod('pushState');
  const restoreReplaceState = wrapHistoryMethod('replaceState');

  window.addEventListener('popstate', emit);
  window.addEventListener('hashchange', emit);

  return () => {
    restorePushState();
    restoreReplaceState();
    window.removeEventListener('popstate', emit);
    window.removeEventListener('hashchange', emit);
  };
}

function mountUI(): void {
  const strategy = getStrategyForHost(window.location.hostname);

  const existingHost = document.getElementById('context-keeper-root');
  if (existingHost) {
    console.warn('[ContextKeeper][Content] Root host already exists. Skipping duplicate mount.');
    return;
  }

  const host = document.createElement('div');
  host.id = 'context-keeper-root';

  const shadowRoot = host.attachShadow({ mode: 'open' });
  const styleTag = document.createElement('style');
  styleTag.textContent = styles;

  const mountPoint = document.createElement('div');
  shadowRoot.appendChild(styleTag);
  shadowRoot.appendChild(mountPoint);

  const rootNode = document.documentElement;
  if (!rootNode) {
    console.warn('[ContextKeeper][Content] document.documentElement is unavailable; mount aborted.');
    return;
  }
  rootNode.appendChild(host);

  const root = createRoot(mountPoint);
  root.render(<App strategy={strategy} />);

  const setTokenCount = useContextStore.getState().setTokenCount;
  let isProcessingPending = false;

  const processPendingHandoff = async (): Promise<void> => {
    if (isProcessingPending) {
      return;
    }

    isProcessingPending = true;

    try {
      const stored = await chrome.storage.local.get([PENDING_HANDOFF_KEY]);
      const pendingText = stored[PENDING_HANDOFF_KEY];

      if (typeof pendingText !== 'string' || pendingText.trim().length === 0) {
        return;
      }

      await chrome.storage.local.remove(PENDING_HANDOFF_KEY);

      const inputSelectors = getInputSelectorsForHost(window.location.hostname);
      const input = await strategy.waitForElement<HTMLElement>(inputSelectors, {
        timeoutMs: 20000,
        intervalMs: 300
      });

      if (!input) {
        console.warn('[ContextKeeper][Content] Pending handoff exists but input did not mount in time.', {
          selectors: inputSelectors
        });
        return;
      }

      const injected = await strategy.injectPrompt(pendingText);
      if (!injected) {
        console.warn('[ContextKeeper][Content] Failed to auto-inject pending handoff payload.');
      }
    } catch (error) {
      console.warn('[ContextKeeper][Content] Error while processing pending handoff cache.', {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      isProcessingPending = false;
    }
  };

  const stopObserving = strategy.observeMutations((text) => {
    void safeSendMessage<{ ok: boolean }>(
      {
        type: 'CK_CHAT_TEXT',
        payload: { text }
      } as CKMessage,
      { retries: 2 }
    ).catch((error) => {
      console.warn('[ContextKeeper][Content] Failed to send CK_CHAT_TEXT.', {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });

  chrome.runtime.onMessage.addListener((message: CKMessage) => {
    if (message.type === 'CK_REQUEST_TEXT_REFRESH') {
      const refreshedText = strategy.getChatText();
      void safeSendMessage<{ ok: boolean }>(
        {
          type: 'CK_CHAT_TEXT',
          payload: { text: refreshedText }
        } as CKMessage,
        { retries: 2 }
      ).catch((error) => {
        console.warn('[ContextKeeper][Content] Failed to send refreshed CK_CHAT_TEXT.', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }

    if (message.type === 'CK_TOKEN_UPDATED') {
      setTokenCount(message.payload.tokenCount);
    }
  });

  const initialText = strategy.getChatText();
  void safeSendMessage<{ ok: boolean }>(
    {
      type: 'CK_CHAT_TEXT',
      payload: { text: initialText }
    } as CKMessage,
    { retries: 2 }
  ).catch((error) => {
    console.warn('[ContextKeeper][Content] Failed to send initial CK_CHAT_TEXT.', {
      error: error instanceof Error ? error.message : String(error)
    });
  });

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local') {
      return;
    }

    if (changes[PENDING_HANDOFF_KEY]?.newValue !== undefined) {
      void processPendingHandoff();
    }
  };

  const stopUrlObserver = installUrlObserver(() => {
    void processPendingHandoff();
  });

  chrome.storage.onChanged.addListener(onStorageChanged);
  void processPendingHandoff();

  window.addEventListener('beforeunload', () => {
    stopObserving();
    stopUrlObserver();
    chrome.storage.onChanged.removeListener(onStorageChanged);
    root.unmount();
    host.remove();
  });
}

mountUI();
