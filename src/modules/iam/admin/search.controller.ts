import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { toE164 } from '@modules/auth/login/phone';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { PermissionResolver } from '../permission-resolver.service';
import { AdminSearchQuery, SEARCH_EXAMPLE, type SearchResultDto, SearchResultsDto } from './search.dto';

type Kind = 'code' | 'email' | 'phone';

/** How the text is searched: an e-mail or a phone number matches exactly (PDPA: audited), anything else a code. */
export function searchKind(q: string): { kind: Kind; value: string } {
  if (q.includes('@')) return { kind: 'email', value: q.toLowerCase() };
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 9 && /^[+\d\s()-]+$/.test(q)) {
    const phone = toE164(q);
    if (phone) return { kind: 'phone', value: phone };
  }
  return { kind: 'code', value: q };
}

@ApiSurface('admin', 'users')
@Controller('search')
export class AdminSearchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolver,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiEndpoint({
    id: 'admin.search.find',
    summary: 'Find a record by code, phone or e-mail',
    description:
      'Orders, order groups, quotations, RFQs, customers, companies, factories, shipments, claims and accounts — ' +
      'only the types whose read permission I hold. A code matches anywhere in the code; an e-mail or a phone ' +
      'number matches exactly and the look-up is audited as data access (PDPA), without the searched value.',
    implements: ['D-140'],
  })
  @ApiSuccess(200, { description: 'Results', type: SearchResultsDto, example: SEARCH_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async find(@CurrentActor() actor: Actor, @Query() query: AdminSearchQuery): Promise<SearchResultsDto> {
    if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
    const can = (await this.permissions.forUser(actor.userId)).permissions;
    const limit = query.limit ?? 10;
    const { kind, value } = searchKind(query.q.trim());
    const like = { contains: value, mode: 'insensitive' as const };
    const results: SearchResultDto[] = [];
    const add = (rows: SearchResultDto[]) => results.push(...rows);

    if (kind === 'code') {
      if (can.has('orders.read')) {
        const orders = await this.prisma.order.findMany({
          where: { orderCode: like },
          select: { publicId: true, orderCode: true, status: true },
          orderBy: { id: 'desc' },
          take: limit,
        });
        add(
          orders.map((o) => ({
            type: 'order',
            id: o.publicId,
            code: o.orderCode,
            title: o.orderCode,
            subtitle: o.status,
          })),
        );
        const groups = await this.prisma.orderGroup.findMany({
          where: { OR: [{ groupCode: like }, { poNumber: like }] },
          select: { publicId: true, groupCode: true, status: true },
          orderBy: { id: 'desc' },
          take: limit,
        });
        add(
          groups.map((g) => ({
            type: 'order_group',
            id: g.publicId,
            code: g.groupCode,
            title: g.groupCode,
            subtitle: g.status,
          })),
        );
      }
      if (can.has('quotes.read')) {
        const quotes = await this.prisma.quote.findMany({
          where: { quoteCode: like },
          select: { publicId: true, quoteCode: true, status: true },
          orderBy: { id: 'desc' },
          take: limit,
        });
        add(
          quotes.map((x) => ({
            type: 'quote',
            id: x.publicId,
            code: x.quoteCode,
            title: x.quoteCode ?? '',
            subtitle: x.status,
          })),
        );
      }
      if (can.has('rfqs.read')) {
        const rfqs = await this.prisma.rfq.findMany({
          where: { rfqCode: like },
          select: { publicId: true, rfqCode: true, status: true },
          orderBy: { id: 'desc' },
          take: limit,
        });
        add(
          rfqs.map((x) => ({
            type: 'rfq',
            id: x.publicId,
            code: x.rfqCode,
            title: x.rfqCode,
            subtitle: x.status,
          })),
        );
      }
      if (can.has('customers.read')) {
        const customers = await this.prisma.customerProfile.findMany({
          where: { customerCode: like },
          select: { customerCode: true, user: { select: { publicId: true, displayName: true } } },
          orderBy: { userId: 'desc' },
          take: limit,
        });
        add(
          customers.map((c) => ({
            type: 'customer',
            id: c.user.publicId,
            code: c.customerCode,
            title: c.user.displayName,
            subtitle: c.customerCode,
          })),
        );
      }
      if (can.has('companies.read')) {
        const companies = await this.prisma.company.findMany({
          where: { OR: [{ companyCode: like }, { legalName: like }, { taxId: value }] },
          select: { publicId: true, companyCode: true, legalName: true, status: true },
          orderBy: { id: 'desc' },
          take: limit,
        });
        add(
          companies.map((c) => ({
            type: 'company',
            id: c.publicId,
            code: c.companyCode,
            title: c.legalName,
            subtitle: c.status,
          })),
        );
      }
      if (can.has('partners.read')) {
        const factories = await this.prisma.factory.findMany({
          where: { OR: [{ code: like }, { legalName: like }, { tradeName: like }] },
          select: { publicId: true, code: true, legalName: true, tradeName: true, status: true },
          orderBy: { id: 'desc' },
          take: limit,
        });
        add(
          factories.map((f) => ({
            type: 'factory',
            id: f.publicId,
            code: f.code,
            title: f.tradeName ?? f.legalName,
            subtitle: f.status,
          })),
        );
      }
      if (can.has('shipments.read')) {
        const shipments = await this.prisma.shipment.findMany({
          where: { OR: [{ shipmentNo: like }, { trackingNo: value }] },
          select: { publicId: true, shipmentNo: true, status: true },
          orderBy: { id: 'desc' },
          take: limit,
        });
        add(
          shipments.map((x) => ({
            type: 'shipment',
            id: x.publicId,
            code: x.shipmentNo,
            title: x.shipmentNo,
            subtitle: x.status,
          })),
        );
      }
      if (can.has('claims.read')) {
        const claims = await this.prisma.claim.findMany({
          where: { claimNo: like },
          select: { publicId: true, claimNo: true, status: true },
          orderBy: { id: 'desc' },
          take: limit,
        });
        add(
          claims.map((x) => ({
            type: 'claim',
            id: x.publicId,
            code: x.claimNo,
            title: x.claimNo,
            subtitle: x.status,
          })),
        );
      }
    } else {
      // A person: customers (customers.read) and accounts (users.read), matched exactly.
      const where = kind === 'email' ? { email: value } : { phone: value };
      if (can.has('customers.read')) {
        const customers = await this.prisma.user.findMany({
          where: { kind: 'customer', anonymisedAt: null, ...where },
          select: { publicId: true, displayName: true, customerProfile: { select: { customerCode: true } } },
          take: limit,
        });
        add(
          customers.map((c) => ({
            type: 'customer',
            id: c.publicId,
            code: c.customerProfile?.customerCode ?? null,
            title: c.displayName,
            subtitle: c.customerProfile?.customerCode ?? null,
          })),
        );
      }
      if (can.has('users.read')) {
        const users = await this.prisma.user.findMany({
          where: { kind: { in: ['staff', 'partner'] }, anonymisedAt: null, ...where },
          select: { publicId: true, displayName: true, kind: true },
          take: limit,
        });
        add(
          users.map((u) => ({
            type: 'user',
            id: u.publicId,
            code: null,
            title: u.displayName,
            subtitle: u.kind,
          })),
        );
      }
      await this.audit.recordStandalone({
        category: 'data_access',
        action: 'admin_search.personal_data',
        resourceType: 'user',
        data: { by: kind, results: results.length },
      });
    }
    return { data: results.slice(0, limit) };
  }
}
