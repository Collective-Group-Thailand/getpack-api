import { RequestContext } from '@common/context/request-context';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PermissionGuard } from '../iam/permission.guard';
import { withAliases } from '../iam/permission-resolver.service';
import { ROLES } from '../iam/roles.catalog';
import { AdminPnlController } from './pnl.controller';

const OPERATION = 'swagger/apiOperation';
const PATH = 'path';

/** Every route handler of the P&L controller with its operation id. */
function handlers(): { name: string; operationId: string; handler: object }[] {
  const proto = AdminPnlController.prototype as unknown as Record<string, object>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && Reflect.getMetadata(PATH, proto[name]!) !== undefined)
    .map((name) => ({
      name,
      handler: proto[name]!,
      operationId: (Reflect.getMetadata(OPERATION, proto[name]!) as { operationId: string }).operationId,
    }));
}

async function allowed(roleKey: string, handler: object): Promise<boolean> {
  const role = ROLES.find((r) => r.key === roleKey)!;
  const guard = new PermissionGuard(
    new Reflector(),
    {
      forUser: () =>
        Promise.resolve({ roles: [{ key: role.key }], permissions: withAliases([...role.permissions]) }),
    } as never,
    { recordStandalone: jest.fn().mockResolvedValue(undefined) } as never,
  );
  const ctx = {
    getHandler: () => handler,
    getClass: () => AdminPnlController,
    switchToHttp: () => ({ getRequest: () => ({ method: 'GET', route: { path: '/x' } }) }),
  } as unknown as ExecutionContext;
  jest
    .spyOn(RequestContext, 'actor')
    .mockReturnValue({ type: 'user', audience: 'staff', userId: 1n } as never);
  try {
    return await guard.canActivate(ctx);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth.forbidden') return false;
    throw error;
  }
}

const READ = [
  'admin.pnl.listLines',
  'admin.pnl.listPlans',
  'admin.pnl.getPlan',
  'admin.pnl.getGrid',
  'admin.pnl.getVariance',
  'admin.pnl.listCellSources',
];
const MANAGE = [
  'admin.pnl.createPlan',
  'admin.pnl.updatePlan',
  'admin.pnl.deletePlan',
  'admin.pnl.updateCell',
  'admin.pnl.recompute',
  'admin.pnl.copyPlan',
  'admin.pnl.lockPlan',
  'admin.pnl.setVarianceNote',
];
const EXPORT = ['admin.pnl.exportPlan'];

describe('P&L planner RBAC (D-472): c_level, vp, director, finance_manager, superadmin — nobody else', () => {
  const all = handlers();

  it('guards every operation with a pnl.* permission', () => {
    expect(all.map((h) => h.operationId).sort()).toEqual([...READ, ...MANAGE, ...EXPORT].sort());
    for (const h of all) {
      const required = Reflect.getMetadata('getpack:required-permissions', h.handler) as string[];
      const expected = READ.includes(h.operationId)
        ? 'pnl.read'
        : MANAGE.includes(h.operationId)
          ? 'pnl.manage'
          : 'pnl.export';
      expect([h.operationId, required]).toEqual([h.operationId, [expected]]);
    }
  });

  it('grants pnl.* only to the roles D-472 names (VP / Director read only)', () => {
    const holders = (key: string) =>
      ROLES.filter((r) => (r.permissions as readonly string[]).includes(key))
        .map((r) => r.key)
        .sort();
    expect(holders('pnl.read')).toEqual(['c_level', 'director', 'finance_manager', 'superadmin', 'vp']);
    expect(holders('pnl.manage')).toEqual(['c_level', 'finance_manager', 'superadmin']);
    expect(holders('pnl.export')).toEqual(['c_level', 'finance_manager', 'superadmin']);
  });

  it.each(['c_level', 'finance_manager', 'superadmin'])('lets %s reach every operation', async (role) => {
    for (const h of all)
      expect([h.operationId, await allowed(role, h.handler)]).toEqual([h.operationId, true]);
  });

  it.each(['vp', 'director'])('lets %s read but not change or export', async (role) => {
    for (const h of all)
      expect([h.operationId, await allowed(role, h.handler)]).toEqual([
        h.operationId,
        READ.includes(h.operationId),
      ]);
  });

  it.each([
    'sales_rep',
    'sales_manager',
    'sales_agent',
    'finance',
    'auditor',
    'admin',
    'cs',
    'marketing',
    'partner_manager',
  ])('refuses %s on every operation (403)', async (role) => {
    for (const h of all)
      expect([h.operationId, await allowed(role, h.handler)]).toEqual([h.operationId, false]);
  });

  it('refuses every factory and company role', async () => {
    for (const role of ROLES.filter((r) => r.audience !== 'staff'))
      for (const h of all.slice(0, 1))
        expect([role.key, await allowed(role.key, h.handler)]).toEqual([role.key, false]);
  });
});
