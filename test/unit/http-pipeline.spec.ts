import { type INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createHttpPipelineApp } from '../fixtures/http-pipeline';
import { PipelineTestController } from '../fixtures/pipeline-test.controller';

const KEY = '3b241101-e2bb-4255-8caf-4136c566a962';

describe('HTTP pipeline', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeEach(async () => {
    app = await createHttpPipelineApp();
    server = app.getHttpServer();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('problem details', () => {
    it('renders unknown routes as a localised 404 problem (th by default)', async () => {
      const res = await request(server).get('/v1/nowhere').expect(404);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.headers['content-language']).toBe('th');
      expect(res.body).toEqual({
        type: 'https://errors.packio/http.not_found',
        title: 'ไม่พบข้อมูล',
        status: 404,
        code: 'http.not_found',
        detail: 'ไม่พบข้อมูลหรือเส้นทางที่ร้องขอ',
        requestId: expect.any(String),
      });
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
    });

    it('localises to English by Accept-Language', async () => {
      const res = await request(server)
        .get('/v1/nowhere')
        .set('Accept-Language', 'en-US,en;q=0.9')
        .expect(404);
      expect(res.body.title).toBe('Not found');
      expect(res.headers['content-language']).toBe('en');
    });

    it('echoes a safe incoming x-request-id', async () => {
      const res = await request(server)
        .get('/v1/nowhere')
        .set('x-request-id', 'bff-req-12345678')
        .expect(404);
      expect(res.body.requestId).toBe('bff-req-12345678');
    });

    it('hides internal errors behind internal.unexpected', async () => {
      const res = await request(server).get('/v1/pipeline-test/boom').expect(500);
      expect(res.body.code).toBe('internal.unexpected');
      expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    });

    it('maps malformed JSON to http.malformed_json', async () => {
      const res = await request(server)
        .post('/v1/pipeline-test/things')
        .set('Idempotency-Key', KEY)
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(400);
      expect(res.body.code).toBe('http.malformed_json');
    });
  });

  describe('validation', () => {
    it('returns 422 validation.failed with field paths', async () => {
      const res = await request(server)
        .post('/v1/pipeline-test/things')
        .set('Idempotency-Key', KEY)
        .send({ name: 42, items: [{ sku: 'A', quantity: 0 }], extra: true })
        .expect(422);
      expect(res.body.code).toBe('validation.failed');
      const paths = (res.body.errors as { path: string; code: string }[]).map((e) => `${e.path}:${e.code}`);
      expect(paths).toEqual(
        expect.arrayContaining(['name:isString', 'items[0].quantity:min', 'extra:whitelistValidation']),
      );
    });
  });

  describe('idempotency', () => {
    const body = { name: 'Box', items: [{ sku: 'A', quantity: 1 }] };

    it('requires an Idempotency-Key', async () => {
      const res = await request(server).post('/v1/pipeline-test/things').send(body).expect(400);
      expect(res.body.code).toBe('idempotency.key_required');
    });

    it('optional mode: passes through without a key and deduplicates with one', async () => {
      await request(server).post('/v1/pipeline-test/optional-things').send(body).expect(201);
      await request(server).post('/v1/pipeline-test/optional-things').send(body).expect(201);
      expect(app.get(PipelineTestController).calls).toBe(2);
      const first = await request(server)
        .post('/v1/pipeline-test/optional-things')
        .set('Idempotency-Key', KEY)
        .send(body)
        .expect(201);
      const replay = await request(server)
        .post('/v1/pipeline-test/optional-things')
        .set('Idempotency-Key', KEY)
        .send(body)
        .expect(201);
      expect(replay.body).toEqual(first.body);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(app.get(PipelineTestController).calls).toBe(3);
      await request(server)
        .post('/v1/pipeline-test/optional-things')
        .set('Idempotency-Key', 'nope')
        .send(body)
        .expect(400);
    });

    it('rejects a key that is not a uuid', async () => {
      const res = await request(server)
        .post('/v1/pipeline-test/things')
        .set('Idempotency-Key', 'nope')
        .send(body)
        .expect(400);
      expect(res.body.code).toBe('idempotency.key_invalid');
    });

    it('replays the original response for the same key and body', async () => {
      const first = await request(server)
        .post('/v1/pipeline-test/things')
        .set('Idempotency-Key', KEY)
        .send(body)
        .expect(201);
      const replay = await request(server)
        .post('/v1/pipeline-test/things')
        .set('Idempotency-Key', KEY)
        .send({ items: [{ quantity: 1, sku: 'A' }], name: 'Box' }) // same payload, different key order
        .expect(201);
      expect(replay.body).toEqual(first.body);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(app.get(PipelineTestController).calls).toBe(1);
    });

    it('rejects the same key with a different body', async () => {
      await request(server)
        .post('/v1/pipeline-test/things')
        .set('Idempotency-Key', KEY)
        .send(body)
        .expect(201);
      const res = await request(server)
        .post('/v1/pipeline-test/things')
        .set('Idempotency-Key', KEY)
        .send({ ...body, name: 'Other' })
        .expect(422);
      expect(res.body.code).toBe('idempotency.key_reused');
    });

    it('releases the key when the handler fails so the client can retry', async () => {
      await request(server)
        .post('/v1/pipeline-test/fail-once')
        .set('Idempotency-Key', KEY)
        .send({})
        .expect(409);
      const retry = await request(server)
        .post('/v1/pipeline-test/fail-once')
        .set('Idempotency-Key', KEY)
        .send({})
        .expect(200);
      expect(retry.body).toEqual({ ok: true });
    });
  });

  describe('ETag / If-Match', () => {
    it('sets an ETag and accepts an update with the current one', async () => {
      const read = await request(server).get('/v1/pipeline-test/thing').expect(200);
      const etag = read.headers.etag as string;
      expect(etag).toMatch(/^"[\w-]+"$/);
      const updated = await request(server)
        .put('/v1/pipeline-test/thing')
        .set('If-Match', etag)
        .send({ name: 'New' })
        .expect(200);
      expect(updated.headers.etag).not.toBe(etag);
    });

    it('returns 412 concurrency.stale for an outdated ETag', async () => {
      const res = await request(server)
        .put('/v1/pipeline-test/thing')
        .set('If-Match', '"outdated"')
        .send({ name: 'New' })
        .expect(412);
      expect(res.body.code).toBe('concurrency.stale');
    });

    it('returns 428 when If-Match is missing', async () => {
      const res = await request(server).put('/v1/pipeline-test/thing').send({ name: 'New' }).expect(428);
      expect(res.body.code).toBe('concurrency.precondition_required');
    });
  });

  describe('pagination', () => {
    it('pages with defaults and meta', async () => {
      const res = await request(server).get('/v1/pipeline-test/page?page=2&perPage=10').expect(200);
      expect(res.body.meta).toEqual({ page: 2, perPage: 10, total: 30 });
      expect(res.body.data[0]).toEqual({ n: 11 });
    });

    it('caps perPage at 100', async () => {
      const res = await request(server).get('/v1/pipeline-test/page?perPage=101').expect(422);
      expect(res.body.errors[0]).toMatchObject({ path: 'perPage', code: 'max' });
    });
  });
});
