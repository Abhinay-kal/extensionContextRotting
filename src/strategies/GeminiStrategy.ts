import type { LLMDOMStrategy } from '../interfaces/LLMDOMStrategy';

const _p = [
  'user-query, message-content',
  '.model-response-text, .user-query-text',
  'message-list'
];

const Pp = [
  'rich-textarea > div[contenteditable="true"]',
  'div.ql-editor[contenteditable="true"]',
  'div[role="textbox"][contenteditable="true"]'
];

const Tp = [
  'button[aria-label*="Send"]',
  'button[data-test-id="send-button"]'
];

const UI_ANCHOR_SELECTORS = ['main', '[role="main"]', 'body'];
const zp = [
  'message-list',
  'c-wiz[data-is-main="true"]',
  'main'
];

const OBSERVER_DEBOUNCE_MS = 1000;
const WAIT_FOR_ELEMENT_TIMEOUT_MS = 15000;
const WAIT_FOR_ELEMENT_INTERVAL_MS = 300;
const OBSERVER_RETRY_INTERVAL_MS = 2000;

export class GeminiStrategy implements LLMDOMStrategy {
  private queryFirst<T extends Element>(selectors: string[], context: ParentNode = document): T | null {
    for (const selector of selectors) {
      try {
        const element = context.querySelector(selector) as T | null;
        if (element) {
          return element;
        }
      } catch (error) {
        console.warn('[ContextKeeper][GeminiStrategy] Invalid selector:', selector, error);
      }
    }

    return null;
  }

  private queryAllFromFallback(selectors: string[]): Element[] {
    for (const selector of selectors) {
      try {
        const elements = Array.from(document.querySelectorAll(selector));
        if (elements.length > 0) {
          return elements;
        }
      } catch (error) {
        console.warn('[ContextKeeper][GeminiStrategy] Invalid selector:', selector, error);
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
        try {
          const element = document.querySelector(selector) as T | null;
          if (element) {
            return element;
          }
        } catch (error) {
          console.warn('[ContextKeeper][GeminiStrategy] Invalid selector in waitForElement:', selector, error);
        }
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), intervalMs);
      });
    }

    console.warn('[ContextKeeper][GeminiStrategy] waitForElement timed out.', {
      component: 'GeminiStrategy',
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
    const input = this.queryFirst<HTMLDivElement>(Pp);
    if (!input) {
      console.warn('[ContextKeeper][GeminiStrategy] Unable to inject prompt because contenteditable input was not found.');
      return false;
    }

    try {
      input.focus();

      const isContentEditable = input.getAttribute('contenteditable') === 'true';
      if (!isContentEditable) {
        console.warn('[ContextKeeper][GeminiStrategy] Target element is not contenteditable.');
        return false;
      }

      const canExecCommand = document.execCommand('insertText', false, text);
      if (canExecCommand) {
        this.dispatchInputEvents(input);
        this.attemptSend();
        return true;
      }

      console.warn('[ContextKeeper][GeminiStrategy] execCommand failed; falling back to textContent injection.');
      input.textContent = text;
      this.dispatchInputEvents(input);
      this.attemptSend();
      return true;
    } catch (error) {
      console.warn('[ContextKeeper][GeminiStrategy] Prompt injection failed gracefully.', error);
      return false;
    }
  }

  private dispatchInputEvents(element: HTMLElement): void {
    try {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          composed: true
        })
      );
    } catch (error) {
      console.warn('[ContextKeeper][GeminiStrategy] Failed to dispatch input events.', error);
    }
  }

  private attemptSend(): void {
    const sendButton = this.queryFirst<HTMLButtonElement>(Tp);
    if (!sendButton) {
      console.warn(
        '[ContextKeeper][GeminiStrategy] Send button not found. User will need to click send manually.'
      );
      return;
    }

    try {
      sendButton.click();
    } catch (error) {
      console.warn('[ContextKeeper][GeminiStrategy] Failed to click send button.', error);
    }
  }

  public getUIAnchor(): HTMLElement | null {
    const anchor = this.queryFirst<HTMLElement>(UI_ANCHOR_SELECTORS);
    if (!anchor) {
      console.warn('[ContextKeeper][GeminiStrategy] Falling back to document.body for UI anchor.');
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
        console.warn('[ContextKeeper][GeminiStrategy] Chat container not found yet. Retrying.', {
          component: 'GeminiStrategy',
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

    const connectLifecycleObserver = (): void => {
      if (lifecycleObserver) {
        return;
      }

      lifecycleObserver = new MutationObserver(() => {
        if (isStopped) {
          return;
        }

        if (activeContainer && !document.contains(activeContainer)) {
          console.warn('[ContextKeeper][GeminiStrategy] Active chat container was removed; reinitializing observer.');
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
