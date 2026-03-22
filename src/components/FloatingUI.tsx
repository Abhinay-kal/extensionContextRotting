import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LLMDOMStrategy } from '../interfaces/LLMDOMStrategy';
import type { Handoff } from '../types/messages';
import { useContextStore } from '../state/useContextStore';
import { useAuth } from '../auth/AuthProvider';
import { safeSendMessage } from '../utils/messaging';
import { extractChatTitle } from '../utils/titleExtractor';
import { ContextBridge } from './ContextBridge';

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

interface BridgeState {
  active: boolean;
  reference: Handoff;
  status: 'injecting' | 'success' | 'error';
}

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

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return 'just now';
  }

  if (diffMs < hour) {
    const value = Math.floor(diffMs / minute);
    return `${value} minute${value === 1 ? '' : 's'} ago`;
  }

  if (diffMs < day) {
    const value = Math.floor(diffMs / hour);
    return `${value} hour${value === 1 ? '' : 's'} ago`;
  }

  const value = Math.floor(diffMs / day);
  return `${value} day${value === 1 ? '' : 's'} ago`;
}

function getHostLabel(host: string): string {
  if (host.includes('chatgpt')) {
    return 'ChatGPT';
  }
  if (host.includes('gemini')) {
    return 'Gemini';
  }
  return host;
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
  const positionRef = useRef<UIPanelPosition>(position);
  const collapsedRef = useRef<boolean>(isCollapsed);
  const [activeTab, setActiveTab] = useState<'current' | 'library'>('current');
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [libraryHandoffs, setLibraryHandoffs] = useState<Handoff[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [injectingId, setInjectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [bridgeState, setBridgeState] = useState<BridgeState | null>(null);

  const percentage = useMemo(() => {
    if (threshold <= 0) {
      return 0;
    }
    return Math.min(100, (tokenCount / threshold) * 100);
  }, [tokenCount, threshold]);

  const filteredLibraryHandoffs = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) {
      return libraryHandoffs;
    }

    return libraryHandoffs.filter((handoff) => {
      const title = handoff.title.toLowerCase();
      const host = handoff.host.toLowerCase();
      const summary = handoff.summary.toLowerCase();
      return title.includes(query) || host.includes(query) || summary.includes(query);
    });
  }, [libraryHandoffs, libraryQuery]);

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

  const loadLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    try {
      const result = await safeSendMessage<{ handoffs: Handoff[] }>({
        type: 'CK_GET_LIBRARY'
      });
      if (result?.handoffs) {
        const sorted = (result.handoffs as Handoff[]).sort((a, b) => b.timestamp - a.timestamp);
        setLibraryHandoffs(sorted);
      }
    } catch (error) {
      console.warn('[ContextKeeper][FloatingUI] Failed to load library.', error);
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'library' && isReady) {
      void loadLibrary();
    }
  }, [activeTab, isReady, loadLibrary]);

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

  const onPrepareHandoff = async () => {
    setIsInjecting(true);
    setStatus(null);
    try {
      const success = await strategy.injectPrompt(HANDOFF_PROMPT);
      setStatus(success ? 'Handoff prompt prepared in chat input.' : 'Could not inject handoff prompt.');

      if (success && saveToLibrary) {
        try {
          const handoff: Handoff = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            title: extractChatTitle(),
            summary: HANDOFF_PROMPT,
            host: window.location.hostname,
            timestamp: Date.now()
          };
          await safeSendMessage<{ ok: boolean }>({
            type: 'CK_SAVE_HANDOFF',
            payload: handoff
          });
          setStatus('Handoff saved to library and prepared in chat input.');
          setSaveToLibrary(false);
          await loadLibrary();
        } catch (error) {
          console.warn('[ContextKeeper][FloatingUI] Failed to save handoff to library.', error);
          setStatus('Handoff prepared but could not save to library.');
        }
      }
    } finally {
      setIsInjecting(false);
    }
  };

  const onInjectReference = async (handoff: Handoff) => {
    setInjectingId(handoff.id);
    setStatus(null);
    setBridgeState({
      active: true,
      reference: handoff,
      status: 'injecting'
    });

    try {
      const success = await strategy.injectReference(handoff.summary);
      if (success) {
        setBridgeState({
          active: true,
          reference: handoff,
          status: 'success'
        });
        setStatus(`Injected reference: ${handoff.title}`);

        window.setTimeout(() => {
          setBridgeState(null);
          setActiveTab('current');
        }, 1200);
      } else {
        setBridgeState({
          active: true,
          reference: handoff,
          status: 'error'
        });
        setStatus('Could not inject reference.');
      }
    } catch (error) {
      console.warn('[ContextKeeper][FloatingUI] Reference injection failed.', error);
      setBridgeState({
        active: true,
        reference: handoff,
        status: 'error'
      });
      setStatus('Could not inject reference.');
    } finally {
      setInjectingId(null);
    }
  };

  const onDeleteHandoff = async (id: string) => {
    setDeletingId(id);
    try {
      await safeSendMessage<{ ok: boolean }>({
        type: 'CK_DELETE_HANDOFF',
        payload: { id }
      });
      setLibraryHandoffs((prev) => prev.filter((h) => h.id !== id));
      setStatus('Handoff deleted.');
    } catch (error) {
      console.warn('[ContextKeeper][FloatingUI] Failed to delete handoff.', error);
      setStatus('Could not delete handoff.');
    } finally {
      setDeletingId(null);
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
        <div className="w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-300 ease-in-out">
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
          <div className="flex border-b border-slate-100">
            <button
              type="button"
              onClick={() => setActiveTab('current')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === 'current'
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Current State
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === 'library'
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Library
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-4">
            {activeTab === 'current' ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">Session Health</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-700">
                    {loading ? 'Checking...' : tier}
                  </span>
                </div>

                <div className="mb-3 flex items-center gap-4">
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

                <div className="mb-3 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="save-to-library"
                    checked={saveToLibrary}
                    onChange={(e) => setSaveToLibrary(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <label htmlFor="save-to-library" className="text-xs text-slate-600">
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

                {status ? <p className="mt-2 text-xs text-slate-600">{status}</p> : null}
              </>
            ) : (
              <>
                <h2 className="mb-3 text-sm font-semibold text-slate-900">Saved Handoffs</h2>

                {bridgeState?.active ? (
                  <ContextBridge
                    sourceName={bridgeState.reference.title}
                    targetHost={getHostLabel(window.location.hostname)}
                    status={bridgeState.status}
                    onRetry={() => {
                      void onInjectReference(bridgeState.reference);
                    }}
                  />
                ) : (
                  <>
                    <input
                      type="text"
                      value={libraryQuery}
                      onChange={(event) => setLibraryQuery(event.target.value)}
                      placeholder="Search handoffs..."
                      className="mb-3 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-700 outline-none focus:border-slate-400"
                    />

                    {isLoadingLibrary ? (
                      <p className="text-xs text-slate-500">Loading library...</p>
                    ) : filteredLibraryHandoffs.length === 0 ? (
                      <p className="text-xs text-slate-400">No saved handoffs yet.</p>
                    ) : (
                      <div className="max-h-96 space-y-2 overflow-y-auto">
                        {filteredLibraryHandoffs.map((handoff) => {
                          const isExpanded = expandedItemId === handoff.id;
                          return (
                            <div
                              key={handoff.id}
                              className="rounded-lg border border-slate-200 bg-slate-50 p-2"
                            >
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedItemId((prev) => (prev === handoff.id ? null : handoff.id));
                                  }}
                                  className="flex-1 min-w-0 text-left"
                                >
                                  <p className="truncate text-xs font-semibold text-slate-900">{handoff.title}</p>
                                  <div className="mt-1 flex items-center gap-2">
                                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                      {getHostLabel(handoff.host)}
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                      {formatRelativeTime(handoff.timestamp)}
                                    </span>
                                  </div>
                                </button>

                                <div className="flex shrink-0 gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onInjectReference(handoff);
                                    }}
                                    disabled={injectingId === handoff.id || deletingId === handoff.id}
                                    className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                  >
                                    {injectingId === handoff.id ? 'Injecting...' : 'Inject'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onDeleteHandoff(handoff.id);
                                    }}
                                    disabled={deletingId === handoff.id || injectingId === handoff.id}
                                    className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                  >
                                    {deletingId === handoff.id ? '...' : 'Del'}
                                  </button>
                                </div>
                              </div>

                              {isExpanded ? (
                                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2 text-[11px] leading-relaxed text-slate-700">
                                  {handoff.summary.length > 600
                                    ? `${handoff.summary.slice(0, 600)}...`
                                    : handoff.summary}
                                </pre>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {status ? <p className="mt-2 text-xs text-slate-600">{status}</p> : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
