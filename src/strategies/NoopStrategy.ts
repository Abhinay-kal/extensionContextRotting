import type { LLMDOMStrategy } from '../interfaces/LLMDOMStrategy';

export class NoopStrategy implements LLMDOMStrategy {
  public getChatText(): string {
    return '';
  }

  public async injectPrompt(): Promise<boolean> {
    console.warn('[ContextKeeper][NoopStrategy] injectPrompt is not implemented for this host yet.');
    return false;
  }

  public async injectReference(): Promise<boolean> {
    console.warn('[ContextKeeper][NoopStrategy] injectReference is not implemented for this host yet.');
    return false;
  }

  public async extractLastMessage(): Promise<string | null> {
    console.warn('[ContextKeeper][NoopStrategy] extractLastMessage is not implemented for this host yet.');
    return null;
  }

  public async clickNewChat(): Promise<boolean> {
    console.warn('[ContextKeeper][NoopStrategy] clickNewChat is not implemented for this host yet.');
    return false;
  }

  public async waitForElement<T extends HTMLElement>(
    _selectors: string[],
    _options?: { timeoutMs?: number; intervalMs?: number }
  ): Promise<T | null> {
    return null;
  }

  public getUIAnchor(): HTMLElement | null {
    return document.body;
  }

  public observeMutations(): () => void {
    return () => undefined;
  }
}
