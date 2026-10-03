import { randomBytes } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type ApiClient } from '@generated/prisma/client';
import { PasswordService } from '@modules/auth/password.service';
import { CompaniesService } from '@modules/companies/companies.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { type B2bScope, type CompanyApiClientDto, type IssuedCompanyApiClientDto } from './b2b.dto';

type Row = ApiClient & { owner: { publicId: string; displayName: string } | null };

/**
 * D-291 the Company Admin issues the company's API clients — at most `api.max_keys_per_company` active — with scopes;
 * the secret is shown once (argon2id hash kept), a client is revocable. Orders a client places are its owner's (the
 * admin who issued it), for the company.
 */
@Injectable()
export class CompanyApiClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly passwords: PasswordService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(actor: UserActor, companyPublicId: string): Promise<CompanyApiClientDto[]> {
    const company = await this.companies.forMember(actor, companyPublicId, 'company_api.manage');
    const rows = await this.prisma.apiClient.findMany({
      where: { companyId: company.id },
      include: { owner: { select: { publicId: true, displayName: true } } },
      orderBy: { id: 'desc' },
    });
    return rows.map(dto);
  }

  async issue(
    actor: UserActor,
    companyPublicId: string,
    input: { name: string; scopes: B2bScope[] },
  ): Promise<IssuedCompanyApiClientDto> {
    const company = await this.companies.forMember(actor, companyPublicId, 'company_api.manage');
    if (company.status !== 'active')
      throw new DomainException('companies.invalid_status', { params: { status: company.status } });
    const max = Number((await this.settings.value('api.max_keys_per_company')) ?? 0);
    const secret = randomBytes(32).toString('base64url');
    const secretHash = await this.passwords.hash(secret);
    const row = await this.prisma.withTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${company.id} FOR UPDATE`;
      const active = await tx.apiClient.count({ where: { companyId: company.id, status: 'active' } });
      if (active >= max) throw new DomainException('b2b.client_limit', { params: { max } });
      const created = await tx.apiClient.create({
        data: {
          clientId: `pc_${randomBytes(12).toString('hex')}`,
          secretHash,
          name: input.name.trim(),
          companyId: company.id,
          ownerUserId: actor.userId,
          scopes: [...new Set(input.scopes)].sort(),
          createdById: actor.userId,
        },
        include: { owner: { select: { publicId: true, displayName: true } } },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'api_client.issued',
        actor,
        resourceType: 'api_client',
        resourcePublicId: created.publicId,
        data: { companyId: company.publicId, scopes: created.scopes },
      });
      await this.events.record(
        tx,
        {
          type: 'api_client.issued',
          aggregateType: 'api_client',
          aggregateId: created.publicId,
          payload: { apiClientId: created.publicId, companyId: company.publicId, scopes: created.scopes },
        },
        actor,
      );
      return created;
    });
    return { ...dto(row), clientSecret: secret };
  }

  async revoke(
    actor: UserActor,
    companyPublicId: string,
    clientPublicId: string,
  ): Promise<CompanyApiClientDto> {
    const company = await this.companies.forMember(actor, companyPublicId, 'company_api.manage');
    return this.prisma.withTx(async (tx) => {
      const client = await tx.apiClient.findFirst({
        where: { publicId: clientPublicId, companyId: company.id },
      });
      if (!client) throw new DomainException('http.not_found');
      if (client.status === 'revoked') throw new DomainException('b2b.client_revoked');
      const updated = await tx.apiClient.update({
        where: { id: client.id },
        data: { status: 'revoked', updatedById: actor.userId, rowVersion: { increment: 1 } },
        include: { owner: { select: { publicId: true, displayName: true } } },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'api_client.revoked',
        actor,
        resourceType: 'api_client',
        resourcePublicId: client.publicId,
        data: { companyId: company.publicId },
      });
      await this.events.record(
        tx,
        {
          type: 'api_client.revoked',
          aggregateType: 'api_client',
          aggregateId: client.publicId,
          payload: { apiClientId: client.publicId, companyId: company.publicId },
        },
        actor,
      );
      return dto(updated);
    });
  }
}

function dto(r: Row): CompanyApiClientDto {
  return {
    id: r.publicId,
    clientId: r.clientId,
    name: r.name,
    scopes: r.scopes as B2bScope[],
    status: r.status,
    owner: { id: r.owner?.publicId ?? '', displayName: r.owner?.displayName ?? '' },
    lastUsedAt: r.lastUsedAt ? toBangkokIso(r.lastUsedAt) : null,
    createdAt: toBangkokIso(r.createdAt),
  };
}
