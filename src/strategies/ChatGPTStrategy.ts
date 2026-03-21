import type { LLMDOMStrategy } from '../interfaces/LLMDOMStrategy';

const _p = [
  '[data-message-author-role] .prose',
  'div[data-message-id] .markdown',
  'article .whitespace-pre-wrap'
];

const Pp = [
  '#prompt-textarea',
  'textarea[data-id="root"]'
];

const Tp = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send message"]'
];

const UI_ANCHOR_SELECTORS = ['main', '[role="main"]', 'body'];
const zp = [
  'main [class*="react-scroll-to-bottom"]',
  'main > div[role="presentation"]'
];

const OBSERVER_DEBOUNCE_MS = 1000;
const WAIT_FOR_ELEMENT_TIMEOUT_MS = 15000;
const WAIT_FOR_ELEMENT_INTERVAL_MS = 300;
const OBSERVER_RETRY_INTERVAL_MS = 2000;

export class ChatGPTStrategy implements LLMDOMStrategy {
  private queryFirst<T extends Element>(selectors: string[], context: ParentNode = document): T | null {
    for (const selector of selectors) {
      const element = context.querySelector(selector) as T | null;
      if (element) {
        return element;
      }
    }

    console.warn(
      `[ContextKeeper][ChatGPTStrategy] No matching selector found. Tried: ${selectors.join(', ')}`
    );
    return null;
  }

  private queryAllFromFallback(selectors: string[]): Element[] {
    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length > 0) {
        return elements;
      }
    }

    return [];
  }

  private async waitForElement<T extends HTMLElement>(
    selectors: string[],
    options: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<T | null> {
    const timeoutMs = options.timeoutMs ?? WAIT_FOR_ELEMENT_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? WAIT_FOR_ELEMENT_INTERVAL_MS;

    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      for (const selector of selectors) {
        const element = document.querySelector(selector) as T | null;
        if (element) {
          return element;
        }
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), intervalMs);
      });
    }

    console.warn('[ContextKeeper][ChatGPTStrategy] waitForElement timed out.', {
      component: 'ChatGPTStrategy',
      action: 'waitForElement',
      selectors,
      timeoutMs
    });
    return null;
  }

  public getChatText(): string {
    const nodes = this.queryAllFromFallback(_p);
    if (nodes.length === 0) {
      return '';
    }

    return nodes
      .map((node) => node.textContent?.trim() ?? '')
      .filter(Boolean)
      .join('\n\n');
  }

  public async injectPrompt(text: string): Promise<boolean> {
    const input = this.queryFirst<HTMLTextAreaElement>(Pp);
    if (!input) {
      console.warn('[ContextKeeper][ChatGPTStrategy] Unable to inject prompt because input was not found.');
      return false;
    }

    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (!valueSetter) {
      console.warn('[ContextKeeper][ChatGPTStrategy] Native textarea value setter not available.');
      return false;
    }

    try {
      input.focus();
      valueSetter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      const sendButton = this.queryFirst<HTMLButtonElement>(Tp);
      if (!sendButton) {
        console.warn(
          '[ContextKeeper][ChatGPTStrategy] Prompt injected, but send button selector failed. User can submit manually.'
        );
      }

      return true;
    } catch (error) {
      console.warn('[ContextKeeper][ChatGPTStrategy] Prompt injection failed gracefully.', error);
      return false;
    }
  }

  public getUIAnchor(): HTMLElement | null {
    const anchor = this.queryFirst<HTMLElement>(UI_ANCHOR_SELECTORS);
    if (!anchor) {
      console.warn('[ContextKeeper][ChatGPTStrategy] Falling back to document.body for UI anchor.');
      return document.body;
    }
    return anchor;
  }

  public observeMutations(callback: (text: string) => void): () => void {
    let chatObserver: MutationObserver | null = null;
    let lifecycleObserver: MutationObserver | null = null;
    let activeContainer: HTMLElement | null = null;
    let initGeneration = 0;
    let debounceTimer: number | undefined;
    let retryTimer: number | undefined;
    let isStopped = false;

    const dispatchDebounced = (): void => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        if (isStopped) {
          return;
        }
        callback(this.getChatText());
      }, OBSERVER_DEBOUNCE_MS);
    };

    const disconnectChatObserver = (): void => {
      if (chatObserver) {
        chatObserver.disconnect();
        chatObserver = null;
      }
    };

    const connectLifecycleObserver = (): void => {
      if (lifecycleObserver) {
        return;
      }

      lifecycleObserver = new MutationObserver(() => {
        if (isStopped) {
          return;
        }

        if (activeContainer && !document.contains(activeContainer)) {
          console.warn('[ContextKeeper][ChatGPTStrategy] Active chat container was removed; reinitializing observer.');
          disconnectChatObserver();
          activeContainer = null;
          initGeneration += 1;
          void connectToChatContainer(initGeneration);
        }
      });

      lifecycleObserver.observe(document.documentElement, {
        subtree: true,
        childList: true
      });
    };

    const scheduleRetry = (generation: number): void => {
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        if (isStopped || generation !== initGeneration) {
          return;
        }
        void connectToChatContainer(generation);
      }, OBSERVER_RETRY_INTERVAL_MS);
    };

    const connectToChatContainer = async (generation: number): Promise<void> => {
      const container = await this.waitForElement<HTMLElement>(zp);
      if (isStopped || generation !== initGeneration) {
        return;
      }

      if (!container) {
        console.warn('[ContextKeeper][ChatGPTStrategy] Chat container not found yet. Retrying.', {
          component: 'ChatGPTStrategy',
          action: 'observeMutations.connectToChatContainer',
          retryInMs: OBSERVER_RETRY_INTERVAL_MS,
          selectors: zp
        });
        scheduleRetry(generation);
        return;
      }

      activeContainer = container;
      disconnectChatObserver();

      chatObserver = new MutationObserver(() => {
        dispatchDebounced();
      });

      chatObserver.observe(container, {
        subtree: true,
        childList: true,
        characterData: true
      });

      dispatchDebounced();
    };

    connectLifecycleObserver();
    void connectToChatContainer(initGeneration);

    return () => {
      isStopped = true;
      disconnectChatObserver();
      if (lifecycleObserver) {
        lifecycleObserver.disconnect();
        lifecycleObserver = null;
      }
      window.clearTimeout(retryTimer);
      window.clearTimeout(debounceTimer);
    };
  }
}
