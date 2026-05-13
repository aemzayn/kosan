import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);

  console.log(`Server running on http://localhost:${port}`);
  console.log('Try: curl -H "Host: acme.localhost" http://localhost:3000/orders');
}

bootstrap();
