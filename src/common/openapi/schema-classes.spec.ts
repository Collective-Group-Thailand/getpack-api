import { type OpenAPIObject } from '@nestjs/swagger';

import { duplicateSchemaClasses } from './schema-classes';

const doc = (schemas: string[]): OpenAPIObject => ({
  openapi: '3.1.0',
  info: { title: 't', version: '1' },
  paths: {},
  components: { schemas: Object.fromEntries(schemas.map((name) => [name, { type: 'object' }])) },
});

describe('duplicateSchemaClasses', () => {
  class A {}
  class B {}

  it('flags a published component name that two classes share', () => {
    const registry = new Map([['AssemblyDto', new Set<object>([A, B])]]);
    expect(duplicateSchemaClasses(doc(['AssemblyDto']), registry)).toEqual([
      'component "AssemblyDto" is published by 2 different classes: rename all but one',
    ]);
  });

  it('ignores names that are unique or never published (mapped-type helper classes)', () => {
    const registry = new Map([
      ['OrderDto', new Set<object>([A])],
      ['PartialTypeClass', new Set<object>([A, B])],
    ]);
    expect(duplicateSchemaClasses(doc(['OrderDto']), registry)).toEqual([]);
  });
});
