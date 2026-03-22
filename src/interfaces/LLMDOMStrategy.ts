export interface LLMDOMStrategy {
  getChatText(): string;
  injectPrompt(text: string): Promise<boolean>;
  injectReference(summary: string): Promise<boolean>;
  extractLastMessage(): Promise<string | null>;
  clickNewChat(): Promise<boolean>;
  waitForElement<T extends HTMLElement>(
    selectors: string[],
    options?: { timeoutMs?: number; intervalMs?: number }
  ): Promise<T | null>;
  getUIAnchor(): HTMLElement | null;
  observeMutations(callback: (text: string) => void): () => void;
}
