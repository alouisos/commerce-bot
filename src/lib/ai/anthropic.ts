import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

const g = globalThis as unknown as { __anthropic?: Anthropic };

export function getAnthropic(): Anthropic {
  g.__anthropic ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return g.__anthropic;
}
