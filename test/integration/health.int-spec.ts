import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';

describe('/health against PostgreSQL 18 + Redis containers', () => {
  let infra: TestInfra;
  let app: INestApplication;

  beforeAll(async () => {
    infra = await startTestInfra();
    Object.assign(process.env, infra.env);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await stopTestInfra(infra);
  });

  it('reports every dependency up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      details: { database: { status: 'up' }, redis: { status: 'up' }, storage: { status: 'up' } },
    });
  });

  it('returns a 503 problem when a dependency goes down', async () => {
    await infra.redis.stop();
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body.code).toBe('service.unavailable');
  });
});
