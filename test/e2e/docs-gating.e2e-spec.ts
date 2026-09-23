import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp, setupDocs } from '../../src/bootstrap';

const DOC_PATHS = ['/docs', '/docs/swagger', '/docs-json', '/docs.yaml', '/docs/assets/scalar.js'];
const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  INTEGRATIONS_MODE: 'real', // required in production; nothing calls AWS in these tests
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
};

async function startWith(env: Record<string, string | undefined>): Promise<INestApplication> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key];
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    setupDocs(app);
    await app.init();
    return app;
  } finally {
    process.env = saved;
  }
}

describe('/docs* access in production (contract §5)', () => {
  it('is off unless DOCS_ENABLED=true', async () => {
    const app = await startWith({
      ...PRODUCTION_ENV,
      DOCS_ENABLED: 'false',
      DOCS_ALLOWED_CIDRS: '127.0.0.1',
    });
    try {
      for (const path of DOC_PATHS) {
        const res = await request(app.getHttpServer()).get(path);
        expect({ path, status: res.status }).toEqual({ path, status: 404 });
      }
    } finally {
      await app.close();
    }
  });

  it('hides the docs from callers outside DOCS_ALLOWED_CIDRS', async () => {
    const app = await startWith({
      ...PRODUCTION_ENV,
      DOCS_ENABLED: 'true',
      DOCS_ALLOWED_CIDRS: '10.0.0.0/8',
    });
    try {
      for (const path of DOC_PATHS) {
        const res = await request(app.getHttpServer()).get(path);
        expect({ path, status: res.status, code: res.body?.code }).toEqual({
          path,
          status: 404,
          code: 'http.not_found',
        });
      }
    } finally {
      await app.close();
    }
  });

  it('serves the docs to allow-listed callers', async () => {
    const app = await startWith({
      ...PRODUCTION_ENV,
      DOCS_ENABLED: 'true',
      DOCS_ALLOWED_CIDRS: '127.0.0.1, ::1',
    });
    try {
      for (const path of DOC_PATHS) {
        const res = await request(app.getHttpServer()).get(path).redirects(1);
        expect({ path, status: res.status }).toEqual({ path, status: 200 });
      }
    } finally {
      await app.close();
    }
  });
});
