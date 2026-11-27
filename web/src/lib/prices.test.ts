import assert from "node:assert/strict";
import { test } from "node:test";
import { costUsd, parseLlmPrices } from "./prices";

const GEMMA = "gemma4:latest";

test("parseLlmPrices reads USD per million tokens per model, including an explicit zero", () => {
  const prices = parseLlmPrices('{"gemma4:latest":{"input":0,"output":0},"google/gemma-4":{"input":0.1,"output":0.4}}', GEMMA);
  assert.deepEqual(prices.get(GEMMA), { input: 0, output: 0 });
  assert.deepEqual(prices.get("google/gemma-4"), { input: 0.1, output: 0.4 });
});

test("parseLlmPrices names the variable when the value is not JSON", () => {
  assert.throws(() => parseLlmPrices("{gemma4: free}", GEMMA), /LLM_PRICES_USD_PER_MTOK is not valid JSON/);
});

test("parseLlmPrices rejects a negative price and names the model and field", () => {
  assert.throws(
    () => parseLlmPrices('{"gemma4:latest":{"input":-1,"output":0}}', GEMMA),
    (e: unknown) => e instanceof Error && /LLM_PRICES_USD_PER_MTOK/.test(e.message) && /gemma4:latest/.test(e.message) && /input/.test(e.message),
  );
});

test("parseLlmPrices rejects a missing field, a misspelled field, a string price and a non-object", () => {
  for (const raw of [
    '{"gemma4:latest":{"input":0}}',
    '{"gemma4:latest":{"input":0,"output":0,"ouput":1}}',
    '{"gemma4:latest":{"input":"0","output":0}}',
    "[]",
    "null",
  ]) {
    assert.throws(() => parseLlmPrices(raw, GEMMA), /LLM_PRICES_USD_PER_MTOK is invalid/, raw);
  }
});

test("parseLlmPrices fails when the configured LLM_MODEL has no price (no default price)", () => {
  assert.throws(() => parseLlmPrices('{"other-model":{"input":0,"output":0}}', GEMMA), /no price for model "gemma4:latest" \(LLM_MODEL\)/);
});

test("costUsd multiplies tokens by the per-million price", () => {
  const prices = parseLlmPrices('{"m":{"input":0.5,"output":2}}', "m");
  assert.equal(costUsd(prices, "m", 2_000_000, 500_000), 2);
  assert.equal(costUsd(prices, "m", 0, 0), 0);
});

test("costUsd names a model that has no configured price instead of guessing", () => {
  const prices = parseLlmPrices('{"m":{"input":0,"output":0}}', "m");
  assert.throws(() => costUsd(prices, "gpt-unknown", 10, 10), /No price for model "gpt-unknown" in LLM_PRICES_USD_PER_MTOK/);
});
