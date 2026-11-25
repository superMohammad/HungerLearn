import "server-only";

/** Typed server configuration. Every value is required; a missing one fails loudly at first use. */
export type ServerEnv = {
  databaseUrl: string;
  readonlyDatabaseUrl: string;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  /** Sent as `reasoning_effort`: "high" turns Gemma 4 thinking on, "none" turns it off. */
  llmReasoningEffort: string;
  docprocDir: string;
  docprocBin: string;
  mediaDir: string;
  mediaBin: string;
  mediaOutDir: string;
  uploadDir: string;
  /** hunger-learn-training-generator-prompt.md: the Stage 2 system prompt, used verbatim. */
  trainingPromptPath: string;
  /** Ollama server; its models are unloaded before GPU video renders. */
  ollamaUrl: string;
  /** Shared password of the seeded demo accounts, shown on the sign-in page of this local MVP. */
  demoPassword: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable ${name}. Copy web/.env.example to web/.env.local and fill it in.`);
  }
  return value;
}

export function serverEnv(): ServerEnv {
  return {
    databaseUrl: required("DATABASE_URL"),
    readonlyDatabaseUrl: required("READONLY_DATABASE_URL"),
    llmBaseUrl: required("LLM_BASE_URL"),
    llmModel: required("LLM_MODEL"),
    llmApiKey: required("LLM_API_KEY"),
    llmReasoningEffort: required("LLM_REASONING_EFFORT"),
    docprocDir: required("DOCPROC_DIR"),
    docprocBin: required("DOCPROC_BIN"),
    mediaDir: required("MEDIA_DIR"),
    mediaBin: required("MEDIA_BIN"),
    mediaOutDir: required("MEDIA_OUT_DIR"),
    uploadDir: required("UPLOAD_DIR"),
    trainingPromptPath: required("TRAINING_PROMPT_PATH"),
    ollamaUrl: required("OLLAMA_URL"),
    demoPassword: required("DEMO_PASSWORD"),
  };
}
