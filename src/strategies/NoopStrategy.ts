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

  public getUIAnchor(): HTMLElement | null {
    return document.body;
  }

  public observeMutations(): () => void {
    return () => undefined;
  }
}
