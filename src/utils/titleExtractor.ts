/**
 * Smart title extraction for handoff library naming.
 * Tries multiple strategies to get a meaningful title for the current chat session.
 */

export function extractChatTitle(): string {
  // Primary: Try sidebar extraction (ChatGPT pattern)
  const sidebarTitle = extractFromSidebar();
  if (sidebarTitle) {
    return sidebarTitle;
  }

  // Secondary: Try document.title with fallback cleanup
  const docTitle = extractFromDocumentTitle();
  if (docTitle) {
    return docTitle;
  }

  // Fallback: Timestamp-based name
  return getTimestampFallback();
}

function extractFromSidebar(): string | null {
  try {
    // Look for active sidebar item (ChatGPT uses .bg-token-surface-primary or active list item)
    const activeItems = document.querySelectorAll(
      'li[data-state="selected"], li.active, [class*="active"][class*="sidebar"]'
    );

    for (const item of activeItems) {
      const text = item.textContent?.trim();
      if (text && text.length > 2 && text.length < 200) {
        return text;
      }
    }

    // Try more generic approach: find first non-empty sidebar text
    const sidebarElements = document.querySelectorAll('nav, aside, [role="navigation"]');
    for (const sidebar of sidebarElements) {
      const heading = sidebar.querySelector('a, button, span');
      if (heading) {
        const text = heading.textContent?.trim();
        if (text && text.length > 2 && text.length < 200) {
          return text;
        }
      }
    }
  } catch (error) {
    console.warn('[ContextKeeper][titleExtractor] Failed to extract from sidebar.', error);
  }

  return null;
}

function extractFromDocumentTitle(): string | null {
  try {
    let title = document.title.trim();

    // Remove common suffixes
    const suffixes = [' - ChatGPT', ' - Claude', ' - Gemini', ' - Google'];
    for (const suffix of suffixes) {
      if (title.endsWith(suffix)) {
        title = title.slice(0, -suffix.length).trim();
        break;
      }
    }

    // Validate length
    if (title.length > 2 && title.length < 200) {
      return title;
    }
  } catch (error) {
    console.warn('[ContextKeeper][titleExtractor] Failed to extract from document.title.', error);
  }

  return null;
}

function getTimestampFallback(): string {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  return `Session Snapshot - ${date}`;
}
