import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { EnvService } from "./env";
import { CatalogService } from "./catalog.service";
import { KnowledgeService } from "./knowledge.service";
import { ConversationService } from "./conversation.service";
import { LeadService } from "./lead.service";
import { SupportService } from "./support.service";
import { JobQueueService } from "./job-queue.service";
import { TelegramClient } from "./telegram.client";
import { ResponsePolicyService } from "./response-policy.service";
import { AiService } from "./ai.service";
import { TelegramService } from "./telegram.service";
import { TelegramController } from "./telegram.controller";
import { AdminController } from "./admin.controller";
import { TelegramPollingService } from "./telegram-polling.service";

@Module({
  controllers: [HealthController, TelegramController, AdminController],
  providers: [
    EnvService,
    PrismaService,
    CatalogService,
    KnowledgeService,
    ConversationService,
    LeadService,
    SupportService,
    JobQueueService,
    TelegramClient,
    ResponsePolicyService,
    AiService,
    TelegramService,
    TelegramPollingService
  ]
})
export class AppModule {}
