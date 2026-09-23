import { type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { APP_VERSION, configureApp, setupDocs } from '../../src/bootstrap';
import { buildOpenApiDocument } from '../../src/common/openapi/openapi.document';
import { PipelineTestController } from '../fixtures/pipeline-test.controller';

@Module({ controllers: [PipelineTestController] })
class E2eFixturesModule {}

describe('packio-api (e2e: AppModule + PostgreSQL 18 + Redis, fake integrations)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const buildDocument = (a: INestApplication) => buildOpenApiDocument(a, APP_VERSION);

  // Connection env comes from global-setup (containers).
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, E2eFixturesModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    setupDocs(app);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health reports database, redis and storage up', async () => {
    const res = await request(server).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(Object.keys(res.body.details as object).sort()).toEqual(['database', 'redis', 'storage']);
  });

  it('GET /docs-json serves an OpenAPI 3.1 document with the three audience schemes', async () => {
    const res = await request(server).get('/docs-json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.components.securitySchemes as object).sort()).toEqual([
      'customer',
      'partner',
      'staff',
    ]);
  });

  it('GET /docs serves Swagger UI', async () => {
    const res = await request(server).get('/docs').redirects(1).expect(200);
    expect(res.text).toContain('swagger');
  });

  it.each([
    '/v1/auth/nothing',
    '/v1/store/nothing',
    '/v1/admin/unknown',
    '/v1/partner/nothing',
    '/webhooks/nothing',
  ])('%s → 404 problem+json', async (path) => {
    const res = await request(server).get(path).expect(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({
      code: 'http.not_found',
      status: 404,
      requestId: res.headers['x-request-id'],
    });
  });

  it('sets security headers (helmet)', async () => {
    const res = await request(server).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('replays an idempotent POST through Redis', async () => {
    const key = 'b5a5a5b0-1c1d-4e5f-8a9b-0c1d2e3f4a5b';
    const body = { name: 'Box', items: [{ sku: 'A', quantity: 2 }] };
    const first = await request(server)
      .post('/v1/pipeline-test/things')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post('/v1/pipeline-test/things')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(app.get(PipelineTestController).calls).toBe(1);
  });

  it('rejects a stale If-Match with 412 concurrency.stale', async () => {
    const res = await request(server)
      .put('/v1/pipeline-test/thing')
      .set('If-Match', '"stale"')
      .send({ name: 'x' });
    expect(res.status).toBe(412);
    expect(res.body.code).toBe('concurrency.stale');
  });

  it('builds a byte-identical contract document twice', () => {
    expect(JSON.stringify(buildDocument(app))).toBe(JSON.stringify(buildDocument(app)));
  });
});
