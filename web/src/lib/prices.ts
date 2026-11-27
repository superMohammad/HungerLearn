import { z } from "zod";

const VARIABLE = "LLM_PRICES_USD_PER_MTOK";

/** USD per million tokens. Local models are priced with an explicit 0, never left out. */
export type ModelPrice = { input: number; output: number };
export type LlmPrices = ReadonlyMap<string, ModelPrice>;

const PriceSchema = z.strictObject({ input: z.number().finite().min(0), output: z.number().finite().min(0) });
const PricesSchema = z.record(z.string().min(1), PriceSchema);

/**
 * Parses LLM_PRICES_USD_PER_MTOK, e.g. {"gemma4:latest":{"input":0,"output":0}}. There is no default
 * price: invalid JSON, a bad entry, or no price for the configured model fails with a named error.
 */
export function parseLlmPrices(raw: string, configuredModel: string): LlmPrices {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${VARIABLE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = PricesSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`${VARIABLE} is invalid (expected {"<model>":{"input":<USD/Mtok>,"output":<USD/Mtok>}}): ${problems}`);
  }
  const prices = new Map(Object.entries(parsed.data));
  if (!prices.has(configuredModel)) throw new Error(`${VARIABLE} has no price for model "${configuredModel}" (LLM_MODEL)`);
  return prices;
}

/** Cost of one call in USD, computed when read so a corrected price fixes every report. */
export function costUsd(prices: LlmPrices, model: string, inputTokens: number, outputTokens: number): number {
  const price = prices.get(model);
  if (price === undefined) throw new Error(`No price for model "${model}" in ${VARIABLE}`);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
