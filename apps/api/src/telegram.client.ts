import { Injectable, Logger } from "@nestjs/common";
import { EnvService } from "./env";

@Injectable()
export class TelegramClient {
  private readonly logger = new Logger(TelegramClient.name);

  constructor(private readonly env: EnvService) {}

  async sendMessage(params: {
    chatId: string;
    text: string;
    replyMarkup?: Record<string, unknown>;
  }) {
    if (!this.env.values.TELEGRAM_BOT_TOKEN) {
      this.logger.warn("TELEGRAM_BOT_TOKEN is not configured, skipping outbound message");
      return { skipped: true };
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.env.values.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
          reply_markup: params.replyMarkup
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Telegram API sendMessage failed: ${body}`);
    }

    return response.json();
  }

  async sendPhoto(params: {
    chatId: string;
    photoUrl: string;
    caption?: string;
  }) {
    if (!this.env.values.TELEGRAM_BOT_TOKEN) {
      this.logger.warn("TELEGRAM_BOT_TOKEN is not configured, skipping outbound photo");
      return { skipped: true };
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.env.values.TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          chat_id: params.chatId,
          photo: this.resolvePublicUrl(params.photoUrl),
          caption: params.caption
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Telegram API sendPhoto failed: ${body}`);
    }

    return response.json();
  }

  private resolvePublicUrl(input: string) {
    if (/^https?:\/\//i.test(input)) {
      return input;
    }

    const normalizedPath = input.startsWith("/") ? input : `/${input}`;
    const baseUrl = this.env.values.APP_PUBLIC_URL.replace(/\/$/, "");

    return `${baseUrl}${normalizedPath}`;
  }
}
