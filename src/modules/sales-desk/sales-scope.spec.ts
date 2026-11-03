import { ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from '@common/auth/can.decorator';
import { RequestContext } from '@common/context/request-context';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PermissionGuard } from '../iam/permission.guard';
import { type SalesScope, SalesScopeService } from './sales-scope';

/** D-469: `@CanAny()` and the rep / manager reach of the sales pipeline. */
describe('sales desk scope (D-469)', () => {
  const scope = (over: Partial<SalesScope>): SalesScope => ({
    actor: { type: 'user', audience: 'staff', userId: 7n } as SalesScope['actor'],
    manage: false,
    self: true,
    ownAgent: { id: 42n } as SalesScope['ownAgent'],
    permissions: new Set(),
    ...over,
  });
  const service = new SalesScopeService({} as never, {} as never, {} as never);

  it('limits a rep to their own employee agent', () => {
    expect(service.leadWhere(scope({}), { agentId: 'x' })).toEqual({ agentId: 42n });
    expect(service.leadWhere(scope({ ownAgent: null }), {})).toEqual({ agentId: -1n });
  });

  it('lets a manager list every rep (employee by default) or freelance agents', () => {
    expect(service.leadWhere(scope({ manage: true }), {})).toEqual({ agent: { kind: 'employee' } });
    expect(service.leadWhere(scope({ manage: true }), { agentId: 'a', agentKind: 'freelance' })).toEqual({
      agent: { publicId: 'a', kind: 'freelance' },
    });
  });

  describe('PermissionGuard with @CanAny', () => {
    const run = async (held: string[], meta: Record<string, string[] | undefined>) => {
      const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
      const audit = { recordStandalone: jest.fn().mockResolvedValue(undefined) };
      const guard = new PermissionGuard(
        reflector,
        { forUser: () => Promise.resolve({ roles: [], permissions: new Set(held) }) } as never,
        audit as never,
      );
      const ctx = {
        getHandler: () => null,
        getClass: () => null,
        switchToHttp: () => ({ getRequest: () => ({ method: 'GET', route: { path: '/x' } }) }),
      } as unknown as ExecutionContext;
      jest.spyOn(RequestContext, 'actor').mockReturnValue({
        type: 'user',
        audience: 'staff',
        userId: 1n,
      } as never);
      return guard.canActivate(ctx);
    };

    it('passes with any one of the listed permissions', async () => {
      await expect(
        run(['sales.pipeline.self'], { [ANY_PERMISSIONS]: ['sales.pipeline.self', 'sales.pipeline.manage'] }),
      ).resolves.toBe(true);
      await expect(
        run(['sales.pipeline.manage'], {
          [ANY_PERMISSIONS]: ['sales.pipeline.self', 'sales.pipeline.manage'],
        }),
      ).resolves.toBe(true);
    });

    it('refuses without any of them, and still needs every @Can permission', async () => {
      await expect(
        run(['orders.read'], { [ANY_PERMISSIONS]: ['sales.pipeline.self'] }),
      ).rejects.toMatchObject({ code: 'auth.forbidden' });
      await expect(
        run(['sales.pipeline.self'], {
          [ANY_PERMISSIONS]: ['sales.pipeline.self'],
          [REQUIRED_PERMISSIONS]: ['orders.read'],
        }),
      ).rejects.toMatchObject({ code: 'auth.forbidden' });
    });
  });
});
