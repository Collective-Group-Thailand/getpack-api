import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RealtimePublisher } from '@platform/realtime/realtime.publisher';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

describe('realtime (SSE) and web push (e2e, contract §6 / D-143)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  const tokens: Record<string, { access: string; id: string }> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const role of ['cs', 'logistics']) {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = { access: res.body.accessToken as string, id: res.body.subject.id as string };
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const channelToken = async (who: string) =>
    (
      await request(app.getHttpServer())
        .post('/v1/admin/realtime/auth')
        .auth(tokens[who]!.access, { type: 'bearer' })
        .expect(200)
    ).body as { token: string; channels: string[] };

  /** Reads SSE events until `stop` returns true (or times out). */
  async function readEvents(
    response: Response,
    stop: (events: string[]) => boolean,
    timeoutMs = 10_000,
  ): Promise<string[]> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const events: string[] = [];
    let buffer = '';
    const deadline = Date.now() + timeoutMs;
    while (!stop(events) && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      events.push(...parts.filter((p) => p.trim() !== ''));
    }
    await reader.cancel();
    return events;
  }

  it('streams ids + type for the principal’s own channel only', async () => {
    const auth = await channelToken('cs');
    expect(auth.channels).toEqual([`user:${tokens['cs']!.id}`]);
    const response = await fetch(
      `${baseUrl}/v1/admin/realtime/stream?token=${encodeURIComponent(auth.token)}`,
      {
        headers: { authorization: `Bearer ${tokens['cs']!.access}` },
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const publisher = app.get(RealtimePublisher);
    const pending = readEvents(response, (events) => events.some((e) => e.includes('notification.created')));
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the stream subscribe
    await publisher.publish(`user:${tokens['logistics']!.id}`, { type: 'other.user', id: 'not-for-cs' });
    await publisher.publish(`user:${tokens['cs']!.id}`, {
      type: 'notification.created',
      id: '0192f3a0-7c1e-7d2a-9b1f-00000000e001',
    });
    const events = await pending;
    expect(events[0]).toContain('event: ready');
    const signal = events.find((e) => e.includes('notification.created'))!;
    expect(signal).toContain('"id":"0192f3a0-7c1e-7d2a-9b1f-00000000e001"');
    expect(events.some((e) => e.includes('not-for-cs'))).toBe(false);
  });

  it('refuses a channel token issued to someone else, and a stream without bearer', async () => {
    const auth = await channelToken('logistics');
    const stolen = await fetch(
      `${baseUrl}/v1/admin/realtime/stream?token=${encodeURIComponent(auth.token)}`,
      {
        headers: { authorization: `Bearer ${tokens['cs']!.access}` },
      },
    );
    expect(stolen.status).toBe(401);
    const anonymous = await fetch(
      `${baseUrl}/v1/admin/realtime/stream?token=${encodeURIComponent(auth.token)}`,
    );
    expect(anonymous.status).toBe(401);
    const wrongSurface = await fetch(
      `${baseUrl}/v1/store/realtime/stream?token=${encodeURIComponent(auth.token)}`,
      {
        headers: { authorization: `Bearer ${tokens['logistics']!.access}` },
      },
    );
    expect(wrongSurface.status).toBe(403); // staff token on the store surface
  });

  it('registers web-push subscriptions with the auth secret encrypted, and removes them', async () => {
    const server = app.getHttpServer();
    const key = await request(server)
      .get('/v1/admin/web-push/vapid-public-key')
      .auth(tokens['cs']!.access, { type: 'bearer' })
      .expect(200);
    expect(key.body.vapidPublicKey).toBeTruthy();
    const body = {
      endpoint: 'https://push.example.com/subscription/e2e-1',
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
    };
    const created = await request(server)
      .post('/v1/admin/web-push/subscriptions')
      .auth(tokens['cs']!.access, { type: 'bearer' })
      .send(body)
      .expect(201);
    const row = await prisma.webPushSubscription.findUniqueOrThrow({
      where: { publicId: created.body.id as string },
    });
    expect(Buffer.from(row.authSecretEnc).toString('utf8')).not.toContain('tBHItJI5svbpez7KI4CCXg');

    // The same browser signing in as another user moves the subscription.
    const moved = await request(server)
      .post('/v1/admin/web-push/subscriptions')
      .auth(tokens['logistics']!.access, { type: 'bearer' })
      .send(body)
      .expect(201);
    expect(moved.body.id).toBe(created.body.id);
    await request(server)
      .delete(`/v1/admin/web-push/subscriptions/${created.body.id}`)
      .auth(tokens['cs']!.access, { type: 'bearer' })
      .expect(404);
    await request(server)
      .delete(`/v1/admin/web-push/subscriptions/${created.body.id}`)
      .auth(tokens['logistics']!.access, { type: 'bearer' })
      .expect(204);
    await request(server)
      .post('/v1/admin/web-push/subscriptions')
      .auth(tokens['cs']!.access, { type: 'bearer' })
      .send({ ...body, endpoint: 'http://insecure.example.com/x' })
      .expect(422);
  });
});
