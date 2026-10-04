import { Controller, Get, type INestApplication, Logger } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ApiEndpoint } from '../openapi/decorators';
import { deprecationHeaders, DeprecationInterceptor } from './deprecation';

@Controller('things')
class ThingsController {
  @Get('old')
  @ApiEndpoint({
    id: 'store.things.old',
    summary: 'Old',
    description: 'Old route',
    implements: ['D-005'],
    deprecated: { since: '2026-10-03', sunset: '2026-11-01' },
  })
  old() {
    return { ok: true };
  }

  @Get('new')
  @ApiEndpoint({ id: 'store.things.new', summary: 'New', description: 'New route', implements: ['D-005'] })
  current() {
    return { ok: true };
  }
}

describe('Deprecation (U-B1, U-B5 counter)', () => {
  let app: INestApplication;
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThingsController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    warn.mockRestore();
  });

  it('formats RFC 9745 / RFC 8594 values from Bangkok dates', () => {
    expect(deprecationHeaders({ since: '2026-10-03' })).toEqual({ Deprecation: '@1790960400' });
    expect(deprecationHeaders({ since: '2026-10-03', sunset: '2026-11-01' }).Sunset).toBe(
      'Sat, 31 Oct 2026 17:00:00 GMT',
    );
  });

  it('sends the headers and logs every call of a deprecated operation', async () => {
    warn.mockClear();
    const res = await request(app.getHttpServer()).get('/things/old').expect(200);
    expect(res.headers.deprecation).toBe('@1790960400');
    expect(res.headers.sunset).toBe('Sat, 31 Oct 2026 17:00:00 GMT');
    expect(warn).toHaveBeenCalledWith({
      event: 'deprecated_operation_called',
      operationId: 'store.things.old',
    });
  });

  it('leaves current operations alone', async () => {
    warn.mockClear();
    const res = await request(app.getHttpServer()).get('/things/new').expect(200);
    expect(res.headers.deprecation).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses malformed dates at decoration time', () => {
    expect(() =>
      ApiEndpoint({
        id: 'store.things.bad',
        summary: 's',
        description: 'd',
        implements: ['D-005'],
        deprecated: { since: '3 Oct' },
      }),
    ).toThrow(/YYYY-MM-DD/);
  });
});
