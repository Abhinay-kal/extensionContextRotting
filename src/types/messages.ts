export type SubscriptionTier = 'free' | 'pro';

export interface TokenUpdatePayload {
  tabId: number;
  tokenCount: number;
  threshold: number;
}

export interface Handoff {
  id: string;
  title: string;
  summary: string;
  host: string;
  timestamp: number;
}

export type CKMessage =
  | {
      type: 'CK_CHAT_TEXT';
      payload: {
        text: string;
      };
    }
  | {
      type: 'CK_REQUEST_TEXT_REFRESH';
    }
  | {
      type: 'CK_TOKEN_UPDATED';
      payload: TokenUpdatePayload;
    }
  | {
      type: 'CK_GET_SUBSCRIPTION';
    }
  | {
      type: 'CK_SUBSCRIPTION_RESULT';
      payload: {
        tier: SubscriptionTier;
      };
    }
  | {
      type: 'CK_SAVE_HANDOFF';
      payload: {
        title: string;
        summary: string;
        host: string;
      };
    }
  | {
      type: 'CK_SAVE_HANDOFF_RESULT';
      payload: {
        ok: boolean;
        reason?: string;
      };
    }
  | {
      type: 'CK_GET_LIBRARY';
    }
  | {
      type: 'CK_GET_LIBRARY_RESULT';
      payload: {
        library: Handoff[];
      };
    }
  | {
      type: 'CK_DELETE_HANDOFF';
      payload: {
        id: string;
      };
    }
  | {
      type: 'CK_DELETE_HANDOFF_RESULT';
      payload: {
        ok: boolean;
      };
    };
