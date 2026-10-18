import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { appConfig, type AppConfig } from './config/app.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(appConfig.KEY);
  app.enableCors({ origin: config.frontendOrigin });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Needed so BrowserPoolService.onModuleDestroy closes Chrome on Ctrl+C.
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`API on http://localhost:${config.port}`, 'Bootstrap');
}
await bootstrap();
