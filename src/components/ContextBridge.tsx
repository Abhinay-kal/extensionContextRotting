type BridgeStatus = 'injecting' | 'success' | 'error';

interface ContextBridgeProps {
  sourceName: string;
  targetHost: string;
  status: BridgeStatus;
  onRetry?: () => void;
}

function getArrowClass(status: BridgeStatus): string {
  if (status === 'success') {
    return 'text-emerald-500';
  }

  if (status === 'error') {
    return 'text-red-500';
  }

  return 'text-slate-400';
}

function getNodeClass(status: BridgeStatus): string {
  const base = 'w-[112px] rounded-xl border bg-white p-2 text-center shadow-sm transition';
  if (status === 'success') {
    return `${base} border-emerald-300 animate-pulse-once`;
  }

  if (status === 'error') {
    return `${base} border-red-300`;
  }

  return `${base} border-slate-200`;
}

export function ContextBridge({ sourceName, targetHost, status, onRetry }: ContextBridgeProps): JSX.Element {
  const arrowClass = getArrowClass(status);
  const nodeClass = getNodeClass(status);
  const isInjecting = status === 'injecting';

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Active Bridge</div>
      <div className="flex items-center gap-2">
        <div className={nodeClass}>
          <div className="truncate text-xs font-semibold text-slate-800">{sourceName}</div>
          <div className="mt-1 text-[11px] text-slate-500">Source</div>
        </div>

        <div className="flex-1">
          <svg className={`h-7 w-full ${arrowClass}`} viewBox="0 0 160 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <line
              x1="4"
              y1="12"
              x2="146"
              y2="12"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={isInjecting ? '8 6' : undefined}
              className={isInjecting ? 'animate-[dash_1s_linear_infinite]' : ''}
            />
            <path d="M146 12L136 5M146 12L136 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        <div className={nodeClass}>
          <div className="truncate text-xs font-semibold text-slate-800">{targetHost}</div>
          <div className="mt-1 text-[11px] text-slate-500">Target</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span
          className={`text-xs font-medium ${
            status === 'success' ? 'text-emerald-600' : status === 'error' ? 'text-red-600' : 'text-slate-600'
          }`}
        >
          {status === 'injecting' && 'Injecting context reference...'}
          {status === 'success' && 'Context bridge established.'}
          {status === 'error' && 'Bridge failed. Injection could not complete.'}
        </span>

        {status === 'error' && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}