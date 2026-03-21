import type { LLMDOMStrategy } from '../interfaces/LLMDOMStrategy';
import { ChatGPTStrategy } from './ChatGPTStrategy';
import { GeminiStrategy } from './GeminiStrategy';
import { NoopStrategy } from './NoopStrategy';

export function getStrategyForHost(hostname: string): LLMDOMStrategy {
  if (hostname.includes('chatgpt.com')) {
    return new ChatGPTStrategy();
  }

  if (hostname.includes('gemini.google.com')) {
    return new GeminiStrategy();
  }

  console.warn(`[ContextKeeper] No concrete strategy for host ${hostname}. Falling back to NoopStrategy.`);
  return new NoopStrategy();
}
