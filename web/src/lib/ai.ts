import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import type { z } from "zod";
import { sql } from "@/lib/db";
import { serverEnv } from "@/lib/env";

const PROVIDER_NAME = "local";
const ATTEMPTS = 3;

/**
 * The document version a call was for, stored in `ai_calls` for cost and time per document.
 * `null` only for calls about no document (readiness text-to-SQL). Pass the version being processed,
 * not `doc.currentVersionId`: during a v2 upload that still points at v1.
 */
export type AiCallScope = { documentId: string; versionId: string } | { documentId: string; versionId: null } | null;

export type AiCallSpec<T> = {
  /** What the call is for, e.g. "generate.question"; stored in `ai_calls`. */
  purpose: string;
  /** Bumped whenever the prompt text changes, so metrics can be split by prompt version. */
  promptVersion: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Required, so the compiler catches a caller that forgets it. */
  scope: AiCallScope;
};

function model() {
  const env = serverEnv();
  const provider = createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL: env.llmBaseUrl,
    apiKey: env.llmApiKey,
    supportsStructuredOutputs: true,
  });
  return { languageModel: provider.chatModel(env.llmModel), modelId: env.llmModel, reasoningEffort: env.llmReasoningEffort };
}

/**
 * One structured LLM call through the Vercel AI SDK (Gemma 4 on Ollama by default; any
 * OpenAI-compatible endpoint works). Validated against `schema`, logged to `ai_calls`,
 * retried with a warning on failure, and the last error is raised.
 */
export async function generateStructured<T>(spec: AiCallSpec<T>): Promise<T> {
  const { languageModel, modelId, reasoningEffort } = model();
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const started = Date.now();
    try {
      const result = await generateText({
        model: languageModel,
        system: spec.system,
        prompt: spec.prompt,
        temperature: 0,
        maxRetries: 0,
        output: Output.object({ schema: spec.schema }),
        providerOptions: { [PROVIDER_NAME]: { reasoningEffort } },
      });
      await sql()`
        INSERT INTO ai_calls (purpose, model, prompt_version, input_tokens, output_tokens, duration_ms, document_id, version_id)
        VALUES (${spec.purpose}, ${modelId}, ${spec.promptVersion},
                ${result.usage.inputTokens ?? 0}, ${result.usage.outputTokens ?? 0}, ${Date.now() - started},
                ${spec.scope?.documentId ?? null}, ${spec.scope?.versionId ?? null})`;
      return result.output;
    } catch (error) {
      lastError = error;
      console.warn("ai call failed, retrying", {
        purpose: spec.purpose,
        model: modelId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw new Error(`AI call "${spec.purpose}" failed after ${ATTEMPTS} attempts (model ${modelId})`, {
    cause: lastError,
  });
}
