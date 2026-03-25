import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from "@nestjs/common";
import { EnvService } from "./env";
import { TelegramService } from "./telegram.service";
import { TelegramUpdate } from "./types";

@Controller()
export class TelegramController {
  constructor(
    private readonly env: EnvService,
    private readonly telegram: TelegramService
  ) {}

  @Post("/webhooks/telegram")
  @HttpCode(200)
  async handleTelegramWebhook(
    @Body() body: TelegramUpdate,
    @Headers("x-telegram-bot-api-secret-token") secret?: string
  ) {
    if (
      this.env.values.TELEGRAM_WEBHOOK_SECRET &&
      secret !== this.env.values.TELEGRAM_WEBHOOK_SECRET
    ) {
      throw new UnauthorizedException("Invalid telegram webhook secret");
    }

    return this.telegram.handleIncomingUpdate(body);
  }
}
