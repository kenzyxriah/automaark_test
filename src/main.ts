import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Hearthly search on http://localhost:${port}`);
}
bootstrap();
