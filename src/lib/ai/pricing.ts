export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

// USD per million tokens == micro-USD per token.
const PRICING = {
  "claude-opus-5-5": { input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 5.0 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
} as const satisfies Record<string, Price>;

export type PricedModel = keyof typeof PRICING;

/** Model ids we can meter; CHAT_MODEL must be one of these. */
export const PRICED_MODELS = Object.keys(PRICING) as [PricedModel, ...PricedModel[]];

export function isPricedModel(model: string | undefined | null): model is PricedModel {
  return !!model && Object.prototype.hasOwnProperty.call(PRICING, model);
}

/** The model to record usage under: the one that answered when we can price it, else the configured one. */
export function meteredModel(responseModel: string | undefined | null, configured: string): string {
  return isPricedModel(responseModel) ? responseModel : configured;
}

export function costMicros(model: string, usage: TokenUsage): number {
  if (!isPricedModel(model)) throw new Error(`Unknown model for pricing: ${model}`);
  const p: Price = PRICING[model];
  return Math.round(
    usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite,
  );
}
