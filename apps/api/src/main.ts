import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { EnvService } from "./env";
import { PrismaService } from "./prisma.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });
  app.enableCors({
    origin: true
  });

  const env = app.get(EnvService);
  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);

  await app.listen(env.port);

  const logger = new Logger("Bootstrap");
  logger.log(`API listening on http://localhost:${env.port}`);
}

bootstrap();
