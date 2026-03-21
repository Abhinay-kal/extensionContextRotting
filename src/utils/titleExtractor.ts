/**
 * Intelligently derive a chat title from the current DOM and document state.
 *
 * Priority:
 * 1. Extract from active sidebar element (ChatGPT: look for active li or .bg-token-surface-primary)
 * 2. Use document.title and strip generic suffixes (e.g., " - ChatGPT", " - Gemini")
 * 3. Fallback: "Session Snapshot - [locale date string]"
 */
export function extractChatTitle(): string {
  // PRIMARY: Try to extract from sidebar active element
  const chatGPTActiveSidebarTexts = Array.from(
    document.querySelectorAll('li[class*="active"], li[class*="selected"], .bg-token-surface-primary')
  )
    .map((el) => el.textContent?.trim())
    .filter((text) => text && text.length > 0 && text.length < 200);

  if (chatGPTActiveSidebarTexts.length > 0) {
    return chatGPTActiveSidebarTexts[0] as string;
  }

  // SECONDARY: Use document.title and strip known suffixes
  let title = document.title.trim();

  const suffixesToStrip = [
    ' - ChatGPT',
    ' - ChatGPT (Unofficial)',
    ' - OpenAI',
    ' - Gemini',
    ' - Google',
    ' - Claude',
    ' - Anthropic'
  ];

  for (const suffix of suffixesToStrip) {
    if (title.endsWith(suffix)) {
      title = title.slice(0, -suffix.length).trim();
      break;
    }
  }

  if (title && title.length > 0 && title.length < 200) {
    return title;
  }

  // FALLBACK: Generate a timestamp-based title
  const now = new Date();
  const localeDateString = now.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `Session Snapshot - ${localeDateString}`;
}
