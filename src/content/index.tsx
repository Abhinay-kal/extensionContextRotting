import { createRoot } from 'react-dom/client';
import styles from '../styles/tailwind.css?inline';
import { App } from './App';
import { getStrategyForHost } from '../strategies/getStrategyForHost';
import { useContextStore } from '../state/useContextStore';
import { safeSendMessage } from '../utils/messaging';
import type { CKMessage } from '../types/messages';

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

  window.addEventListener('beforeunload', () => {
    stopObserving();
    root.unmount();
    host.remove();
  });
}

mountUI();
