const RETRY_DELAY_MS = 500;
const RECEIVING_END_ERROR = 'Receiving end does not exist';

interface SafeSendOptions {
  retries?: number;
  fallback?: unknown;
}

/**
 * Safely send a message to the background script with automatic retry logic.
 * Handles the ephemeral nature of MV3 Service Workers by retrying if the
 * receiving end does not exist (e.g., worker is sleeping).
 */
export async function safeSendMessage<T = unknown>(
  message: unknown,
  options: SafeSendOptions = {}
): Promise<T> {
  const maxRetries = options.retries ?? 2;
  const fallback = options.fallback ?? null;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      return response as T;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      const errorMessage = err.message.toLowerCase();
      const isReceivingEndError = errorMessage.includes(RECEIVING_END_ERROR.toLowerCase());

      if (isReceivingEndError && attempt < maxRetries) {
        console.warn(
          `[ContextKeeper][Messaging] Service Worker is sleeping. Retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${maxRetries}).`
        );

        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), RETRY_DELAY_MS);
        });

        continue;
      }

      console.warn(
        `[ContextKeeper][Messaging] Failed to send message after ${attempt + 1} attempt(s).`,
        {
          component: 'messaging',
          action: 'safeSendMessage',
          error: err.message,
          retryAttempt: attempt,
          maxRetries
        }
      );

      return fallback as T;
    }
  }

  console.warn('[ContextKeeper][Messaging] Message failed with unknown error.');
  return fallback as T;
}

/**
 * Extension of safeSendMessage that logs the fallback and provides structured failure info.
 */
export async function safeSendWithFallback<T>(
  message: unknown,
  fallbackValue: T,
  options: Omit<SafeSendOptions, 'fallback'> = {}
): Promise<T> {
  return safeSendMessage<T>(message, {
    ...options,
    fallback: fallbackValue
  });
}
