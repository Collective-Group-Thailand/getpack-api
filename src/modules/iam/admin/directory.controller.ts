import { Can } from '@common/auth/can.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Query } from '@nestjs/common';

import {
  SOD_RULE_EXAMPLE,
  SodRuleDto,
  STAFF_DIRECTORY_EXAMPLE,
  StaffDirectoryEntryDto,
  StaffDirectoryQuery,
} from './directory.dto';

@ApiSurface('admin', 'users')
@Controller('staff-directory')
export class StaffDirectoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiEndpoint({
    id: 'admin.staffDirectory.list',
    summary: 'Find a colleague',
    description:
      'Active staff with their active platform roles, for pickers (assign an RFQ, delegate approvals, D-140). ' +
      '`permission` keeps the holders of a permission through their roles. Any staff member; no e-mail or ' +
      'phone (PDPA least privilege). At most `limit` (50) by name.',
    implements: ['D-140'],
  })
  @ApiSuccess(200, { description: 'Staff', type: [StaffDirectoryEntryDto], example: STAFF_DIRECTORY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: StaffDirectoryQuery): Promise<StaffDirectoryEntryDto[]> {
    const now = new Date();
    const live: Prisma.UserRoleWhereInput = {
      revokedAt: null,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      scopeType: 'platform',
    };
    const users = await this.prisma.user.findMany({
      where: {
        kind: 'staff',
        status: 'active',
        ...(q.q && { displayName: { contains: q.q, mode: 'insensitive' } }),
        AND: [
          ...(q.role ? [{ roles: { some: { ...live, role: { key: q.role } } } }] : []),
          ...(q.permission
            ? [
                {
                  roles: {
                    some: { ...live, role: { permissions: { some: { permission: { key: q.permission } } } } },
                  },
                },
              ]
            : []),
        ],
      },
      select: {
        publicId: true,
        displayName: true,
        roles: { where: live, select: { role: { select: { key: true } } } },
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: q.limit ?? 50,
    });
    return users.map((u) => ({
      id: u.publicId,
      displayName: u.displayName,
      roles: [...new Set(u.roles.map((r) => r.role.key))].sort(),
    }));
  }
}

@ApiSurface('admin', 'roles')
@Controller('sod-rules')
export class SodRulesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Can('users.read')
  @ApiEndpoint({
    id: 'admin.sodRules.list',
    summary: 'List the segregation-of-duties rules',
    description:
      'The active rules role grants and maker-checker actions are checked against (D-168): role pairs nobody ' +
      'holds together and action pairs one person may not do on the same subject. A blocking rule answers ' +
      '409 `iam.sod_conflict` where it applies.',
    implements: ['D-140', 'D-168'],
  })
  @ApiSuccess(200, { description: 'Rules', type: [SodRuleDto], example: [SOD_RULE_EXAMPLE] })
  @ApiStandardErrors()
  async list(): Promise<SodRuleDto[]> {
    const rules = await this.prisma.sodRule.findMany({
      where: { active: true },
      include: { roleA: { select: { key: true } }, roleB: { select: { key: true } } },
      orderBy: { key: 'asc' },
    });
    return rules.map((r) => ({
      id: r.publicId,
      key: r.key,
      kind: r.kind,
      left: (r.kind === 'role_pair' ? r.roleA?.key : r.actionA) ?? '',
      right: (r.kind === 'role_pair' ? r.roleB?.key : r.actionB) ?? '',
      subjectMatch: r.subjectMatch,
      enforcement: r.enforcement,
      description: r.description,
      decisions: r.decisionRefs,
    }));
  }
}
