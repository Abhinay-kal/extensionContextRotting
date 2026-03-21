import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LLMDOMStrategy } from '../interfaces/LLMDOMStrategy';
import type { Handoff } from '../types/messages';
import { useContextStore } from '../state/useContextStore';
import { useAuth } from '../auth/AuthProvider';
import { safeSendMessage } from '../utils/messaging';
import { extractChatTitle } from '../utils/titleExtractor';

const HANDOFF_PROMPT = `Act as a strict state-compression algorithm. We are migrating to a new session to prevent context degradation. Synthesize our entire conversation into a highly dense, technical 'State Document'.

Your output will be used as the absolute source of truth to initialize the next AI. Omit all conversational filler, pleasantries, and meta-commentary. Use telegraphic language and maximize semantic density. Preserve exact file paths, variable names, architecture patterns, and error codes.

Structure the output exactly using these headers:

1. CORE DIRECTIVE & ENVIRONMENT
- The overarching objective of this project.
- The exact tech stack, frameworks, and versions in use.

2. CURRENT STATE (TRUTH)
- What is fully implemented, verified, and functioning?
- What architectural decisions have been locked in?

3. THE GRAVEYARD (DISCARDED PATHS)
- CRITICAL: List the specific approaches, libraries, or logic we tried that FAILED or were REJECTED.
- State *exactly* why they were rejected to prevent the next session from suggesting them again.

4. HARD CONSTRAINTS & ASSUMPTIONS
- Non-negotiable technical, architectural, or business rules.
- Blind spots or assumptions we are currently operating under.

5. ACTIVE BLOCKER(S)
- The precise bug, error code, or logical hurdle we are currently fighting.

6. IMMEDIATE NEXT ACTIONS
- The absolute next 1-2 concrete, executable steps to unblock progress.`;

interface FloatingUIProps {
  strategy: LLMDOMStrategy;
}

interface UIPanelPosition {
  x: number;
  y: number;
}

interface FloatingUIPreferences {
  position: UIPanelPosition;
  isCollapsed: boolean;
}

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

type ActiveTab = 'current' | 'library';

const STORAGE_KEY = 'floatingUIPreferences';
const VIEWPORT_MARGIN = 12;
const KEYBOARD_MOVE_STEP = 16;

function clampPosition(position: UIPanelPosition, width: number, height: number): UIPanelPosition {
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);

  return {
    x: Math.min(Math.max(position.x, VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(position.y, VIEWPORT_MARGIN), maxY)
  };
}

function getFallbackPosition(): UIPanelPosition {
  const fallbackWidth = 320;
  const fallbackHeight = 260;

  return {
    x: Math.max(VIEWPORT_MARGIN, window.innerWidth - fallbackWidth - VIEWPORT_MARGIN),
    y: Math.max(VIEWPORT_MARGIN, window.innerHeight - fallbackHeight - VIEWPORT_MARGIN)
  };
}

function getProgressColor(percent: number): string {
  if (percent >= 100) {
    return '#D64545';
  }
  if (percent >= 90) {
    return '#E0A400';
  }
  return '#18A957';
}

export function FloatingUI({ strategy }: FloatingUIProps): JSX.Element {
  const tokenCount = useContextStore((state) => state.tokenCount);
  const threshold = useContextStore((state) => state.threshold);
  const { loading, tier } = useAuth();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<UIPanelPosition>(getFallbackPosition);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isInjecting, setIsInjecting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('current');
  const [library, setLibrary] = useState<Handoff[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [saveToLibrary, setSaveToLibrary] = useState(false);

  const positionRef = useRef<UIPanelPosition>(position);
  const collapsedRef = useRef<boolean>(isCollapsed);

  const percentage = useMemo(() => {
    if (threshold <= 0) {
      return 0;
    }
    return Math.min(100, (tokenCount / threshold) * 100);
  }, [tokenCount, threshold]);

  const radius = 44;
  const stroke = 8;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const progressColor = getProgressColor(percentage);
  const fabRadius = 24;
  const fabStroke = 5;
  const fabNormalizedRadius = fabRadius - fabStroke / 2;
  const fabCircumference = fabNormalizedRadius * 2 * Math.PI;
  const fabDashOffset = fabCircumference - (percentage / 100) * fabCircumference;

  const savePreferences = useCallback(async (next: FloatingUIPreferences): Promise<void> => {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
    } catch (error) {
      console.warn('[ContextKeeper][FloatingUI] Failed to persist preferences.', error);
    }
  }, []);

  const getClampedFromCurrentRect = (next: UIPanelPosition): UIPanelPosition => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) {
      return next;
    }
    return clampPosition(next, rect.width, rect.height);
  };

  const fetchLibrary = useCallback(async (): Promise<void> => {
    setIsLibraryLoading(true);
    try {
      const result = await safeSendMessage<{ library: Handoff[] }>(
        { type: 'CK_GET_LIBRARY' },
        { retries: 2, fallback: { library: [] } }
      );
      setLibrary(result.library ?? []);
    } catch (error) {
      console.warn('[ContextKeeper][FloatingUI] Failed to fetch library.', error);
      setLibrary([]);
    } finally {
      setIsLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const restorePreferences = async (): Promise<void> => {
      try {
        const stored = await chrome.storage.local.get([STORAGE_KEY]);
        const prefs = stored[STORAGE_KEY] as FloatingUIPreferences | undefined;
        if (!isMounted) {
          return;
        }

        if (!prefs) {
          setIsReady(true);
          return;
        }

        setIsCollapsed(Boolean(prefs.isCollapsed));
        setPosition(prefs.position ?? getFallbackPosition());
      } catch (error) {
        console.warn('[ContextKeeper][FloatingUI] Failed to restore preferences.', error);
      } finally {
        if (isMounted) {
          setIsReady(true);
        }
      }
    };

    void restorePreferences();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setPosition((prev) => getClampedFromCurrentRect(prev));
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isCollapsed, isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const onResize = (): void => {
      setPosition((prev) => getClampedFromCurrentRect(prev));
    };

    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    void savePreferences({
      position,
      isCollapsed
    });
  }, [isCollapsed, isReady, position, savePreferences]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    collapsedRef.current = isCollapsed;
  }, [isCollapsed]);

  // Fetch library when tab is switched to Library
  useEffect(() => {
    if (activeTab === 'library' && isReady) {
      void fetchLibrary();
    }
  }, [activeTab, isReady, fetchLibrary]);

  const onPointerMove = useCallback((event: PointerEvent): void => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const nextPosition: UIPanelPosition = {
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY
    };

    setPosition(clampPosition(nextPosition, rect.width, rect.height));
  }, []);

  const onPointerUp = useCallback(
    (event: PointerEvent): void => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      dragStateRef.current = null;
      setIsDragging(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      void savePreferences({
        position: positionRef.current,
        isCollapsed: collapsedRef.current
      });
    },
    [onPointerMove, savePreferences]
  );

  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>): void => {
      if (event.button !== 0) {
        return;
      }

      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      dragStateRef.current = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };

      setIsDragging(true);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [onPointerMove, onPointerUp]
  );

  const movePanelBy = useCallback((deltaX: number, deltaY: number): void => {
    setPosition((prev) => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) {
        return prev;
      }

      return clampPosition(
        {
          x: prev.x + deltaX,
          y: prev.y + deltaY
        },
        rect.width,
        rect.height
      );
    });
  }, []);

  const onHeaderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setIsCollapsed((prev) => !prev);
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        movePanelBy(-KEYBOARD_MOVE_STEP, 0);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        movePanelBy(KEYBOARD_MOVE_STEP, 0);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        movePanelBy(0, -KEYBOARD_MOVE_STEP);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        movePanelBy(0, KEYBOARD_MOVE_STEP);
      }
    },
    [movePanelBy]
  );

  const onToggleCollapsed = (): void => {
    setIsCollapsed((prev) => !prev);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const getCurrentHost = (): string => {
    const url = new URL(window.location.href);
    if (url.hostname.includes('chatgpt.com')) return 'ChatGPT';
    if (url.hostname.includes('claude.ai')) return 'Claude';
    if (url.hostname.includes('gemini.google.com')) return 'Gemini';
    return 'Unknown';
  };

  const onPrepareHandoff = async () => {
    setIsInjecting(true);
    setStatus(null);
    try {
      if (saveToLibrary) {
        const title = extractChatTitle();
        const host = getCurrentHost();
        const summary = HANDOFF_PROMPT;

        const saveResult = await safeSendMessage<{ ok: boolean; reason?: string }>(
          {
            type: 'CK_SAVE_HANDOFF',
            payload: { title, summary, host }
          },
          { retries: 2, fallback: { ok: false } }
        );

        if (!saveResult.ok) {
          setStatus(`Library save failed: ${saveResult.reason || 'Unknown error'}`);
          return;
        }

        setStatus('Handoff saved to library.');
      }

      const success = await strategy.injectPrompt(HANDOFF_PROMPT);
      setStatus(success ? 'Handoff prompt prepared in chat input.' : 'Could not inject handoff prompt.');
    } finally {
      setIsInjecting(false);
    }
  };

  const onInjectReference = async (handoff: Handoff): Promise<void> => {
    setIsInjecting(true);
    setStatus(null);
    try {
      const success = await strategy.injectReference(handoff.summary);
      setStatus(success ? `Injected: "${handoff.title}"` : 'Could not inject reference.');
    } catch (error) {
      setStatus(`Injection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsInjecting(false);
    }
  };

  const onDeleteHandoff = async (id: string): Promise<void> => {
    try {
      const result = await safeSendMessage<{ ok: boolean }>(
        { type: 'CK_DELETE_HANDOFF', payload: { id } },
        { retries: 2, fallback: { ok: false } }
      );

      if (result.ok) {
        setLibrary((prev) => prev.filter((h) => h.id !== id));
        setStatus('Handoff deleted.');
      } else {
        setStatus('Failed to delete handoff.');
      }
    } catch (error) {
      setStatus(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <div
      ref={panelRef}
      className="ck-scope fixed z-[2147483647] h-auto w-auto select-none overflow-visible transition-all duration-300 ease-in-out"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`
      }}
    >
      {isCollapsed ? (
        <button
          type="button"
          onPointerDown={onHeaderPointerDown}
          onKeyDown={onHeaderKeyDown}
          onClick={() => setIsCollapsed(false)}
          className={`relative flex h-16 w-16 items-center justify-center rounded-full border border-slate-200 bg-white shadow-2xl transition-all duration-300 ease-in-out hover:scale-110 ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          aria-label="Expand ContextKeeper panel"
        >
          <svg
            className="pointer-events-none absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)]"
            viewBox="0 0 48 48"
          >
            <circle
              cx={fabRadius}
              cy={fabRadius}
              r={fabNormalizedRadius}
              fill="transparent"
              stroke="#E5E7EB"
              strokeWidth={fabStroke}
            />
            <circle
              cx={fabRadius}
              cy={fabRadius}
              r={fabNormalizedRadius}
              fill="transparent"
              stroke={progressColor}
              strokeWidth={fabStroke}
              strokeLinecap="round"
              strokeDasharray={`${fabCircumference} ${fabCircumference}`}
              strokeDashoffset={fabDashOffset}
              style={{
                transform: 'rotate(-90deg)',
                transformOrigin: '50% 50%',
                transition: 'stroke-dashoffset 250ms ease-in-out, stroke 250ms ease-in-out'
              }}
            />
          </svg>

          <div className="pointer-events-none z-[1] flex h-full w-full items-center justify-center">
            <span className="text-[11px] font-bold text-slate-900">{Math.round(percentage)}%</span>
          </div>
        </button>
      ) : (
        <div className="w-96 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-300 ease-in-out">
          <div
            onPointerDown={onHeaderPointerDown}
            onKeyDown={onHeaderKeyDown}
            role="button"
            tabIndex={0}
            aria-label="Drag ContextKeeper panel. Press Enter or Space to toggle collapse."
            className={`flex items-center justify-between border-b border-slate-100 px-3 py-2 ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">ContextKeeper</span>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Collapse
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-slate-100 bg-slate-50">
            <button
              type="button"
              onClick={() => setActiveTab('current')}
              className={`flex-1 px-4 py-2 text-xs font-semibold transition ${
                activeTab === 'current'
                  ? 'border-b-2 border-slate-900 bg-white text-slate-900'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Current State
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`flex-1 px-4 py-2 text-xs font-semibold transition ${
                activeTab === 'library'
                  ? 'border-b-2 border-slate-900 bg-white text-slate-900'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Library
            </button>
          </div>

          {/* Current State Tab */}
          {activeTab === 'current' && (
            <div className="p-4 max-h-96 overflow-y-auto">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Session Health</h2>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-700">
                  {loading ? 'Checking...' : tier}
                </span>
              </div>

              <div className="mb-4 flex items-center gap-4">
                <svg width={radius * 2} height={radius * 2} viewBox={`0 0 ${radius * 2} ${radius * 2}`}>
                  <circle
                    cx={radius}
                    cy={radius}
                    r={normalizedRadius}
                    fill="transparent"
                    stroke="#E5E7EB"
                    strokeWidth={stroke}
                  />
                  <circle
                    cx={radius}
                    cy={radius}
                    r={normalizedRadius}
                    fill="transparent"
                    stroke={progressColor}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${circumference} ${circumference}`}
                    style={{
                      strokeDashoffset,
                      transform: 'rotate(-90deg)',
                      transformOrigin: '50% 50%',
                      transition: 'stroke-dashoffset 250ms ease-in-out, stroke 250ms ease-in-out'
                    }}
                  />
                  <text
                    x="50%"
                    y="50%"
                    dominantBaseline="middle"
                    textAnchor="middle"
                    className="fill-slate-800 text-xs font-semibold"
                  >
                    {Math.round(percentage)}%
                  </text>
                </svg>

                <div>
                  <p className="text-xs text-slate-500">Estimated tokens</p>
                  <p className="text-xl font-bold text-slate-900">{tokenCount.toLocaleString()}</p>
                  <p className="text-xs text-slate-600">Threshold: {threshold.toLocaleString()}</p>
                </div>
              </div>

              {/* Save to Library Checkbox */}
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="saveToLibrary"
                  checked={saveToLibrary}
                  onChange={(e) => setSaveToLibrary(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                />
                <label htmlFor="saveToLibrary" className="text-xs text-slate-600">
                  Save to Library & Prepare
                </label>
              </div>

              <button
                type="button"
                onClick={onPrepareHandoff}
                disabled={isInjecting}
                className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isInjecting ? 'Preparing...' : 'Prepare Handoff'}
              </button>

              {status && <p className="mt-2 text-xs text-slate-600">{status}</p>}
            </div>
          )}

          {/* Library Tab */}
          {activeTab === 'library' && (
            <div className="p-4 max-h-96 overflow-y-auto">
              {isLibraryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-xs text-slate-600">Loading library...</p>
                </div>
              ) : library.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-center text-xs text-slate-500">
                    No saved contexts yet. Prepare a handoff and save it to get started.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {[...library].sort((a, b) => b.timestamp - a.timestamp).map((handoff) => (
                    <div
                      key={handoff.id}
                      className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900">{handoff.title}</p>
                        <p className="text-xs text-slate-600">{handoff.host}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(handoff.timestamp).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => onInjectReference(handoff)}
                          disabled={isInjecting}
                          className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                          title="Inject this reference"
                        >
                          Inject
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteHandoff(handoff.id)}
                          disabled={isInjecting}
                          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-60"
                          title="Delete this reference"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {status && <p className="mt-2 text-xs text-slate-600">{status}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
