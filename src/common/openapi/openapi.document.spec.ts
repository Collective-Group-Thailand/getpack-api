import { type OpenAPIObject } from '@nestjs/swagger';

import { contractViolations, normaliseDocument } from './openapi.document';

const doc = (paths: OpenAPIObject['paths'], schemas: Record<string, unknown> = {}): OpenAPIObject =>
  ({ openapi: '3.1.0', info: { title: 't', version: '1' }, paths, components: { schemas } }) as OpenAPIObject;

describe('openapi document', () => {
  it('sorts object keys recursively and keeps array order', () => {
    const output = JSON.stringify(normaliseDocument({ b: 1, a: { d: [3, 1], c: 2 } }));
    expect(output).toBe('{"a":{"c":2,"d":[3,1]},"b":1}');
  });

  it('accepts named enum components and surface-prefixed tags', () => {
    const document = doc(
      {
        '/v1/store/orders': {
          get: {
            tags: ['store.orders'],
            responses: {
              '200': {
                description: '',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderStatus' } } },
              },
            },
          },
        },
      },
      { OrderStatus: { type: 'string', enum: ['waiting_payment'] } },
    );
    expect(contractViolations(document)).toEqual([]);
  });

  it('reports inline enums and unprefixed tags', () => {
    const document = doc({
      '/v1/admin/orders': {
        get: {
          tags: ['orders'],
          parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['a'] } }],
          responses: {},
        },
      },
    });
    const problems = contractViolations(document);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/inline enum/);
    expect(problems[1]).toMatch(/GET \/v1\/admin\/orders: tags must be prefixed/);
  });
});
