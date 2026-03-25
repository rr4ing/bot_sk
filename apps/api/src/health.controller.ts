import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("/health")
  health() {
    return {
      status: "ok",
      timestamp: new Date().toISOString()
    };
  }

  @Get("/ready")
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: "ready",
      timestamp: new Date().toISOString()
    };
  }
}
