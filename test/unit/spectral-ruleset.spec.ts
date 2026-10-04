import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lintWithPackioRuleset } from '../support/spectral';

/** One operation that breaks every Packio rule at least once. */
const badDocument = {
  openapi: '3.1.0',
  info: { title: 'bad', version: '1', description: 'bad', contact: {} },
  servers: [{ url: 'http://localhost:3000' }],
  tags: [{ name: 'store.things', description: 'Things' }],
  paths: {
    '/v1/store/things': {
      post: {
        operationId: 'Things_create',
        description: 'No decision reference here.',
        tags: ['store.things', 'things'],
        security: [{ staff: [] }],
        parameters: [{ name: 'kind', in: 'query', schema: { type: 'string', enum: ['a', 'b'] } }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } } },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: { type: 'object' },
                example: {
                  email: 'somchai@gmail.com',
                  phone: '081-234-5678',
                  taxId: '1234567890123',
                  card: '4111 1111 1111 1111',
                },
              },
            },
          },
          '202': {
            description: 'Accepted',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } },
          },
          '404': {
            description: 'Not found',
            content: { 'application/json': { schema: { type: 'string' }, example: 'x' } },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: { staff: { type: 'http', scheme: 'bearer' } },
    schemas: {
      A: { type: 'object', properties: { name: { type: 'string' } } },
      B: { type: 'object', properties: { name: { type: 'string', description: 'same shape as A' } } },
      ProblemDetails: { type: 'object', properties: { code: { type: 'string' } } },
    },
  },
};

describe('Packio Spectral ruleset (contract/spectral)', () => {
  it('passes the committed contract', () => {
    const contract: unknown = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'contract', 'openapi.json'), 'utf8'),
    );
    expect(lintWithPackioRuleset(contract).map((r) => `${r.code}: ${r.message}`)).toEqual([]);
  });

  it('fires every Packio rule on a document that breaks them', () => {
    const results = lintWithPackioRuleset(badDocument);
    const codes = new Set(results.map((r) => r.code));
    expect([...codes].filter((code) => code.startsWith('packio-')).sort()).toEqual([
      'packio-no-duplicate-schemas',
      'packio-no-inline-enum',
      'packio-no-real-personal-data',
      'packio-object-shape',
      'packio-operation-id',
      'packio-operation-implements',
      'packio-operation-summary',
      'packio-operation-surface-tag',
      'packio-request-example',
      'packio-response-example',
      'packio-response-set',
      'packio-status-by-kind',
      'packio-surface-security',
    ]);
  });

  it('asks for 412 with If-Match, 409 with Idempotency-Key and a named poll with 202', () => {
    const doc = structuredClone(badDocument) as unknown as {
      paths: Record<string, { post: { parameters: unknown[] } }>;
    };
    doc.paths['/v1/store/things']!.post.parameters.push(
      { name: 'If-Match', in: 'header', schema: { type: 'string' } },
      { name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } },
    );
    const messages = lintWithPackioRuleset(doc)
      .filter((r) => r.code === 'packio-status-by-kind')
      .map((r) => r.message)
      .sort();
    expect(messages).toEqual([
      '202 must name the operation to poll (@ApiAsync)',
      'Idempotency-Key operation without a 409 response',
      'If-Match operation without a 412 response',
    ]);
  });

  it('flags each kind of real-looking personal data', () => {
    const messages = lintWithPackioRuleset(badDocument)
      .filter((r) => r.code === 'packio-no-real-personal-data')
      .map((r) => r.message)
      .join('\n');
    expect(messages).toMatch(/email "somchai@gmail.com"/);
    expect(messages).toMatch(/phone "081-234-5678"/);
    expect(messages).toMatch(/13-digit id "1234567890123"/);
    expect(messages).toMatch(/looks like a card number/);
  });

  it('reports the missing responses and non-problem errors', () => {
    const messages = lintWithPackioRuleset(badDocument)
      .filter((r) => r.code === 'packio-response-set')
      .map((r) => r.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'missing 500 response (every operation can fail unexpectedly)',
        'missing 401 response (secured operation)',
        'missing 422 response (operation has a request body)',
        '404 must be application/problem+json only',
      ]),
    );
  });

  it('accepts public (`security: []`) and optional-auth store operations, but no foreign scheme', () => {
    const surface = (security: unknown) => {
      const doc = structuredClone(badDocument) as unknown as {
        paths: Record<string, { post: { security: unknown } }>;
      };
      doc.paths['/v1/store/things']!.post.security = security;
      return lintWithPackioRuleset(doc).filter((r) => r.code === 'packio-surface-security');
    };
    expect(surface([])).toEqual([]);
    expect(surface([{}, { customer: [] }])).toEqual([]);
    expect(surface([{ customer: [] }])).toEqual([]);
    expect(surface([{}, { staff: [] }])).toHaveLength(1);
    expect(surface(undefined)).toHaveLength(1);
  });

  it('accepts obviously fake data', () => {
    const fake = structuredClone(badDocument);
    fake.paths['/v1/store/things'].post.responses['201'].content['application/json'].example = {
      email: 'customer@example.com',
      phone: '081-000-1234',
      taxId: '0000000000001',
      card: 'n/a',
    };
    expect(lintWithPackioRuleset(fake).filter((r) => r.code === 'packio-no-real-personal-data')).toEqual([]);
  });
});
