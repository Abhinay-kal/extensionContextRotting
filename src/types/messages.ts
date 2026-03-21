export type SubscriptionTier = 'free' | 'pro';

export interface TokenUpdatePayload {
  tabId: number;
  tokenCount: number;
  threshold: number;
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
    };
