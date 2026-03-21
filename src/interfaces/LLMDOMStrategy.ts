export interface LLMDOMStrategy {
  getChatText(): string;
  injectPrompt(text: string): Promise<boolean>;
  injectReference(summary: string): Promise<boolean>;
  getUIAnchor(): HTMLElement | null;
  observeMutations(callback: (text: string) => void): () => void;
}
