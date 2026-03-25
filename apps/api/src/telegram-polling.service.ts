import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { EnvService } from "./env";
import { TelegramService } from "./telegram.service";
import { TelegramUpdate } from "./types";

@Injectable()
export class TelegramPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollingService.name);
  private running = false;
  private offset = 0;

  constructor(
    private readonly env: EnvService,
    private readonly telegramService: TelegramService
  ) {}

  onModuleInit() {
    if (
      this.env.values.TELEGRAM_TRANSPORT === "polling" &&
      this.env.values.TELEGRAM_BOT_TOKEN
    ) {
      this.running = true;
      void this.loop();
      this.logger.log("Telegram polling mode enabled");
    }
  }

  onModuleDestroy() {
    this.running = false;
  }

  private async loop() {
    while (this.running) {
      try {
        const updates = await this.fetchUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.telegramService.handleIncomingUpdate(update);
        }
      } catch (error) {
        this.logger.error("Telegram polling failed", error as Error);
        await this.sleep(3000);
      }
    }
  }

  private async fetchUpdates(): Promise<TelegramUpdate[]> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.env.values.TELEGRAM_BOT_TOKEN}/getUpdates`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          timeout: 25,
          offset: this.offset,
          allowed_updates: ["message"]
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed: ${response.status}`);
    }

    const body = (await response.json()) as {
      ok: boolean;
      result: TelegramUpdate[];
    };

    return body.result ?? [];
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
