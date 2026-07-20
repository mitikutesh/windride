// adapters/ai — bring-your-own-key AI client (WR-044). See client.ts for the transport contract.
export {
  AI_PROVIDERS,
  isAiProvider,
  type AiClient,
  type AiProvider,
  type AiProviderMeta,
  type AiRequest,
} from './types';
export { AiHttpClient, type AiClientOptions } from './client';
