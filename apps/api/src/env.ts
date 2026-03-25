import { Injectable } from "@nestjs/common";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  QUEUE_MODE: z.enum(["redis", "inline"]).default("redis"),
  AI_PROVIDER: z.enum(["auto", "openai", "xai"]).default("auto"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  XAI_API_KEY: z.string().optional(),
  XAI_MODEL: z.string().default("grok-4-1-fast"),
  XAI_BASE_URL: z.string().url().default("https://api.x.ai/v1"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_MANAGER_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_TRANSPORT: z.enum(["webhook", "polling"]).default("polling"),
  APP_PUBLIC_URL: z.string().default("http://localhost:3000"),
  ADMIN_PUBLIC_URL: z.string().default("http://localhost:3001")
});

export type AppEnv = z.infer<typeof envSchema>;

@Injectable()
export class EnvService {
  readonly values: AppEnv;

  constructor() {
    this.values = envSchema.parse(process.env);
  }

  get port() {
    return this.values.PORT;
  }

  get openAiEnabled() {
    return this.languageModelEnabled;
  }

  get languageModelProvider() {
    const { AI_PROVIDER, XAI_API_KEY, OPENAI_API_KEY } = this.values;

    if (AI_PROVIDER === "xai" && XAI_API_KEY) {
      return "xai" as const;
    }

    if (AI_PROVIDER === "openai" && OPENAI_API_KEY) {
      return "openai" as const;
    }

    if (AI_PROVIDER === "auto") {
      if (XAI_API_KEY) {
        return "xai" as const;
      }

      if (OPENAI_API_KEY) {
        return "openai" as const;
      }
    }

    return null;
  }

  get languageModelApiKey() {
    if (this.languageModelProvider === "xai") {
      return this.values.XAI_API_KEY ?? null;
    }

    if (this.languageModelProvider === "openai") {
      return this.values.OPENAI_API_KEY ?? null;
    }

    return null;
  }

  get languageModelName() {
    if (this.languageModelProvider === "xai") {
      return this.values.XAI_MODEL;
    }

    return this.values.OPENAI_MODEL;
  }

  get languageModelBaseUrl() {
    if (this.languageModelProvider === "xai") {
      return this.values.XAI_BASE_URL;
    }

    return undefined;
  }

  get languageModelEnabled() {
    return Boolean(this.languageModelProvider && this.languageModelApiKey);
  }
}
