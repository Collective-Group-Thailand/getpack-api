import './instrument';

import { AppConfig } from '@config/app-config';
import { loadSecretsIntoEnv } from '@config/secrets.loader';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp, setupDocs } from './bootstrap';

async function bootstrap(): Promise<void> {
  const secrets = await loadSecretsIntoEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app);
  setupDocs(app);

  if (secrets.loadedKeys.length > 0)
    logger.log(`Loaded ${secrets.loadedKeys.length} variables from Secrets Manager`);

  const port = app.get(AppConfig).get('PORT');
  await app.listen(port);
  logger.log(`packio-api listening on :${port}`);
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- the logger may not exist yet (e.g. invalid environment)
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
