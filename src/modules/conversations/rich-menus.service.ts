import { type UserActor } from '@common/context/actor';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type LineAccount, type RichMenuAudience } from '@generated/prisma/client';
import { LINE_MESSAGING, type LineMessaging } from '@integrations/line-messaging/line-messaging.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

/**
 * The OA rich menus (D-151): designed in LINE, registered here by key with their audience; one active menu
 * per audience. Guests (not signed in with LINE) see the guest menu; once the LINE user is linked to a
 * customer (LINE Login / LIFF) the member menu (order status, slip upload, artwork approval, reorder,
 * points, chat) replaces it.
 */
@Injectable()
export class RichMenusService {
  private readonly logger = new Logger(RichMenusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LINE_MESSAGING) private readonly line: LineMessaging,
  ) {}

  list() {
    return this.prisma.lineRichMenu.findMany({ orderBy: [{ audience: 'asc' }, { key: 'asc' }] });
  }

  async upsert(
    actor: UserActor,
    key: string,
    input: { audience: RichMenuAudience; providerMenuId: string; active: boolean },
  ) {
    return this.prisma.withTx(async (tx) => {
      if (input.active)
        await tx.lineRichMenu.updateMany({
          where: { audience: input.audience, active: true, key: { not: key } },
          data: { active: false, updatedById: actor.userId },
        });
      const menu = await tx.lineRichMenu.upsert({
        where: { key },
        create: { key, ...input, updatedById: actor.userId },
        update: { ...input, updatedById: actor.userId },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'line.rich_menu_saved',
        resourceType: 'line_rich_menu',
        data: { key, audience: input.audience, active: input.active },
      });
      return menu;
    });
  }

  /** Shows the menu for the account's audience (member when linked to a customer). */
  async show(account: LineAccount, db: Tx = this.prisma): Promise<void> {
    const audience: RichMenuAudience = account.userId ? 'member' : 'guest';
    const menu = await db.lineRichMenu.findFirst({ where: { audience, active: true } });
    if (!menu || account.richMenuKey === menu.key) return;
    await this.line.linkRichMenu(account.lineUserId, menu.providerMenuId);
    await db.lineAccount.update({ where: { id: account.id }, data: { richMenuKey: menu.key } });
  }

  /** A customer linked LINE: their OA account becomes theirs, with the member menu. */
  @OnDomainEvent('customer.identity_linked', { consumer: 'line.link_account' })
  async onLinked(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['provider'] !== 'line') return;
    const user = await tx.user.findUnique({ where: { publicId: event.aggregateId } });
    if (!user) return;
    const identities = await tx.userIdentity.findMany({
      where: { userId: user.id, provider: 'line', unlinkedAt: null },
    });
    const accounts = await tx.lineAccount.findMany({
      where: { lineUserId: { in: identities.map((i) => i.providerSubject) } },
    });
    for (const account of accounts) {
      const linked = await tx.lineAccount.update({
        where: { id: account.id },
        data: { userId: user.id, linkedAt: new Date(), unlinkedAt: null },
      });
      await tx.conversation.updateMany({
        where: { lineAccountId: account.id, customerUserId: null },
        data: { customerUserId: user.id },
      });
      try {
        await this.show(linked, tx);
      } catch (error) {
        this.logger.warn({ err: (error as Error).message }, 'member rich menu not shown');
      }
    }
  }
}
