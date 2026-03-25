import { Injectable } from "@nestjs/common";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  QUEUE_MODE: z.enum(["redis", "inline"]).default("redis"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
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
    return Boolean(this.values.OPENAI_API_KEY);
  }
}
