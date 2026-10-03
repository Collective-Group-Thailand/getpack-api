import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { scopeClaim, ScopeDirectory } from '@modules/iam/scope-directory';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { SettingsService } from '@platform/settings/settings.service';

import { PasswordService } from '../password.service';
import { TokenService } from '../tokens/token.service';

export interface ClientCredentialsToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}

/**
 * OAuth2 client-credentials grant for partner machine clients (ADR-0004, RFC 6749 §4.4). The token
 * is partner-audience and carries the client's factory scope; there is no refresh token.
 */
@Injectable()
export class ClientCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly scopes: ScopeDirectory,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async issue(clientId: string, clientSecret: string): Promise<ClientCredentialsToken> {
    const client = await this.prisma.apiClient.findUnique({ where: { clientId } });
    const ok = await this.passwords.verify(client?.secretHash, clientSecret);
    const usable =
      client && ok && client.status === 'active' && (!client.expiresAt || client.expiresAt > new Date());
    if (!usable) {
      await this.audit.recordStandalone({
        category: 'security',
        action: 'auth.client_token_denied',
        outcome: 'denied',
        actor: { type: 'system', name: 'oauth-token' },
        ...(client && { data: { apiClientId: client.id } }),
      });
      throw new DomainException('auth.invalid_client');
    }
    // A factory's client gets `aud=partner`, a company's `aud=b2b` (D-291); a client with neither has no scope.
    let scope: string;
    let aud: 'partner' | 'b2b';
    if (client.factoryId !== null) {
      const factory = (await this.scopes.publicIds('factory', [client.factoryId])).get(client.factoryId);
      if (!factory) throw new DomainException('auth.scope_unavailable');
      scope = scopeClaim('factory', factory);
      aud = 'partner';
    } else if (client.companyId !== null) {
      const company = await this.prisma.company.findUnique({ where: { id: client.companyId } });
      if (!company || company.status !== 'active') throw new DomainException('auth.scope_unavailable');
      scope = scopeClaim('company', company.publicId);
      aud = 'b2b';
    } else throw new DomainException('auth.scope_unavailable');

    const scp = [scope, ...client.scopes].sort();
    const ttl = await this.settings.value('auth.access_token_ttl_seconds');
    const { token } = await this.tokens.issue({ sub: client.publicId, aud, scp, pty: 'client' }, ttl);
    await this.prisma.withTx(async (tx) => {
      await tx.apiClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });
      await this.audit.record(tx, {
        category: 'security',
        action: 'auth.client_token_issued',
        actor: {
          type: 'api_client',
          apiClientId: client.id,
          publicId: client.publicId,
          audience: aud,
          scopes: scp,
        },
        resourceType: 'api_client',
        resourcePublicId: client.publicId,
      });
    });
    return { access_token: token, token_type: 'Bearer', expires_in: ttl, scope: scp.join(' ') };
  }
}
