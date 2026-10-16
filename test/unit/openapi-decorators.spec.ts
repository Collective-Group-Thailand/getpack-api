import { ApiEndpoint } from '@common/openapi/decorators';
import { buildOpenApiDocument, contractViolations } from '@common/openapi/openapi.document';
import { API_TAGS } from '@common/openapi/tags';
import { type INestApplication, Module } from '@nestjs/common';
import { type OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { configureApp } from '../../src/bootstrap';
import { DocsExampleController } from '../fixtures/docs-example.controller';
import { lintWithGetpackRuleset } from '../support/spectral';

@Module({ controllers: [DocsExampleController] })
class DocsExampleModule {}

type Responses = Record<
  string,
  { headers?: Record<string, unknown>; content?: Record<string, { examples?: object }> }
>;

describe('OpenAPI documentation decorators', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    API_TAGS['admin.examples'] = 'Test-only examples resource.';
    const moduleRef = await Test.createTestingModule({ imports: [DocsExampleModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    document = buildOpenApiDocument(app, '0.0.0-test');
  });

  afterAll(async () => {
    delete API_TAGS['admin.examples'];
    await app.close();
  });

  const op = (path: string, method: 'get' | 'post' | 'put') => document.paths[path]![method]!;
  const responses = (path: string, method: 'get' | 'post' | 'put') => op(path, method).responses as Responses;
  const exampleCodes = (path: string, method: 'get' | 'post' | 'put', status: string) =>
    Object.keys(
      responses(path, method)[status]?.content?.['application/problem+json']?.examples ?? {},
    ).sort();

  it('produces a document with no contract violations and no Spectral findings', () => {
    expect(contractViolations(document)).toEqual([]);
    expect(
      lintWithGetpackRuleset(document).map((r) => `${r.code} ${r.path.join('.')}: ${r.message}`),
    ).toEqual([]);
  });

  it('merges problem codes from several decorators per status', () => {
    expect(exampleCodes('/v1/admin/examples', 'post', '400')).toEqual([
      'http.bad_request',
      'http.malformed_json',
      'idempotency.key_invalid',
      'idempotency.key_required',
    ]);
    expect(exampleCodes('/v1/admin/examples', 'post', '422')).toEqual([
      'idempotency.key_reused',
      'validation.failed',
    ]);
    expect(exampleCodes('/v1/admin/examples', 'post', '409')).toEqual(['idempotency.in_progress']);
    expect(exampleCodes('/v1/admin/examples/{exampleId}', 'put', '412')).toEqual(['concurrency.stale']);
    expect(exampleCodes('/v1/admin/examples/{exampleId}', 'put', '428')).toEqual([
      'concurrency.precondition_required',
    ]);
  });

  it('adds surface auth errors, rate limiting and 500 everywhere', () => {
    for (const [path, method] of [
      ['/v1/admin/examples', 'get'],
      ['/v1/admin/examples', 'post'],
      ['/v1/admin/examples/{exampleId}', 'put'],
    ] as const) {
      expect(Object.keys(responses(path, method))).toEqual(
        expect.arrayContaining(['401', '403', '429', '500']),
      );
      expect(op(path, method).security).toEqual([{ staff: [] }]);
      expect(responses(path, method)['429']?.headers).toHaveProperty('Retry-After');
    }
  });

  it('documents headers and parameters by reference', () => {
    const create = responses('/v1/admin/examples', 'post')['201']!.headers!;
    expect(Object.keys(create).sort()).toEqual([
      'Idempotent-Replayed',
      'Location',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Request-Id',
    ]);
    expect(responses('/v1/admin/examples/{exampleId}', 'get')['200']!.headers).toHaveProperty('ETag');
    expect(op('/v1/admin/examples', 'post').parameters).toEqual(
      expect.arrayContaining([
        { $ref: '#/components/parameters/IdempotencyKey' },
        { $ref: '#/components/parameters/AcceptLanguage' },
      ]),
    );
    expect(op('/v1/admin/examples/{exampleId}', 'put').parameters).toEqual(
      expect.arrayContaining([{ $ref: '#/components/parameters/IfMatch' }]),
    );
  });

  it('defines shared components once and only when used', () => {
    expect(Object.keys(document.components?.examples ?? {})).toContain('problem.validation.failed');
    expect(Object.keys(document.components?.examples ?? {})).not.toContain('problem.service.unavailable');
    expect(document.tags).toEqual([{ name: 'admin.examples', description: 'Test-only examples resource.' }]);
  });

  it('rejects malformed operation ids and missing references at decoration time', () => {
    expect(() =>
      ApiEndpoint({ id: 'Examples_list', summary: 's', description: 'd', implements: ['D-052'] }),
    ).toThrow(/must match/);
    expect(() =>
      ApiEndpoint({ id: 'admin.examples.list', summary: 's', description: 'd', implements: [] }),
    ).toThrow(/implements/);
  });
});
