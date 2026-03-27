import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { AppModule } from "./app.module";
import { EnvService } from "./env";
import { PrismaService } from "./prisma.service";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true
  });
  app.enableCors({
    origin: true
  });
  app.useStaticAssets(join(process.cwd(), "public"), {
    prefix: "/public/"
  });

  const env = app.get(EnvService);
  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);

  await app.listen(env.port);

  const logger = new Logger("Bootstrap");
  logger.log(`API listening on http://localhost:${env.port}`);
}

bootstrap();
