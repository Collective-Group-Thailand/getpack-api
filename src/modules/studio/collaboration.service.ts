import { randomBytes } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type ShareScope } from '@generated/prisma/client';
import {
  DESIGN_INCLUDE,
  type DesignRow,
  DesignsService,
  type PatchDesignInput,
} from '@modules/designs/designs.service';
import { Injectable } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;
const COMMENT_INCLUDE = {
  author: { select: { publicId: true, displayName: true } },
  resolvedBy: { select: { publicId: true, displayName: true } },
  version: { select: { versionNo: true } },
  parent: { select: { publicId: true } },
} satisfies Prisma.DesignCommentInclude;
export type CommentRow = Prisma.DesignCommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

export interface CommentInput {
  body: string;
  /** A face of the 3D box (`faceId` + UV) or a point on the flat (`xMm`, `yMm`). */
  anchor?: { faceId?: string; u?: number; v?: number; xMm?: number; yMm?: number } | null;
  parentId?: string;
  mentions?: string[];
  versionNo?: number;
}

/** Who may do what on a design: its owner, a member of its company, a link holder (with the link's scope). */
interface Access {
  doc: DesignRow;
  owner: boolean;
  member: boolean;
  scope: ShareScope | null;
}

/**
 * D-285 collaboration on a studio design: many share links, each scoped view / comment / edit, expiring after
 * `configurations.share_link_days` and revocable (tokens hashed, shown once); comments anchored to a face (UV) or a
 * point on the flat, threaded, resolvable, with @mentions of the owner and the company's members — notified through
 * the outbox, never inline. Comment and edit need a signed-in user; edit only a member of the design's company.
 */
@Injectable()
export class CollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly designs: DesignsService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
  ) {}

  // --- links ------------------------------------------------------------------------------------------------

  async createLink(actor: UserActor, designId: string, scope: ShareScope) {
    const doc = await this.designs.get(designId, actor.userId);
    const days = (await this.settings.at('configurations.share_link_days')).value;
    const token = randomBytes(32).toString('base64url');
    const link = await this.prisma.withTx(async (tx) => {
      const row = await tx.designShareLink.create({
        data: {
          documentId: doc.id,
          scope,
          tokenHash: sha256(token),
          createdById: actor.userId,
          expiresAt: new Date(Date.now() + days * DAY_MS),
        },
      });
      // Never the token: it is shown once, to its creator.
      await this.event(tx, actor, doc.publicId, 'design.share_link_created', { linkId: row.publicId, scope });
      return row;
    });
    return { link, token };
  }

  async links(actor: UserActor, designId: string) {
    const doc = await this.designs.get(designId, actor.userId);
    return this.prisma.designShareLink.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeLink(actor: UserActor, designId: string, linkId: string) {
    const doc = await this.designs.get(designId, actor.userId);
    await this.prisma.withTx(async (tx) => {
      const link = await tx.designShareLink.findFirst({ where: { publicId: linkId, documentId: doc.id } });
      if (!link) throw new DomainException('http.not_found');
      if (link.revokedAt) return;
      await tx.designShareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
      await this.event(tx, actor, doc.publicId, 'design.share_link_revoked', { linkId });
    });
  }

  /** A live link's design and scope; anything else (unknown, revoked, expired, deleted) is 404. */
  async byToken(token: string): Promise<{ doc: DesignRow; scope: ShareScope; expiresAt: Date }> {
    if (!TOKEN.test(token)) throw new DomainException('http.not_found');
    const link = await this.prisma.designShareLink.findUnique({
      where: { tokenHash: sha256(token) },
      include: { document: { include: DESIGN_INCLUDE } },
    });
    if (!link || link.revokedAt || link.expiresAt <= new Date() || link.document.deletedAt)
      throw new DomainException('http.not_found');
    return { doc: link.document, scope: link.scope, expiresAt: link.expiresAt };
  }

  /** Edit through an edit link: a signed-in member of the design's company (D-285), under If-Match. */
  async editShared(actor: UserActor, token: string, ifMatch: string | undefined, input: PatchDesignInput) {
    const { doc, scope } = await this.byToken(token);
    if (scope !== 'edit' || !(await this.isMember(actor.userId, doc)))
      throw new DomainException('designs.share_scope');
    return this.designs.patch(actor, doc.publicId, ifMatch, input);
  }

  // --- comments ---------------------------------------------------------------------------------------------

  async comments(access: Access): Promise<CommentRow[]> {
    if (!access.owner && !access.member && access.scope !== 'comment' && access.scope !== 'edit')
      throw new DomainException('designs.share_scope');
    return this.prisma.designComment.findMany({
      where: { documentId: access.doc.id },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(actor: UserActor, access: Access, input: CommentInput): Promise<CommentRow> {
    if (!access.owner && !access.member && access.scope !== 'comment' && access.scope !== 'edit')
      throw new DomainException('designs.share_scope');
    const doc = access.doc;
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    const parent = input.parentId
      ? await this.prisma.designComment.findFirst({ where: { publicId: input.parentId, documentId: doc.id } })
      : null;
    if (input.parentId && (!parent || parent.parentId !== null))
      throw invalid('parentId', 'a thread of this design');
    if (parent && input.anchor) throw invalid('anchor', 'a reply has no anchor');
    const version =
      input.versionNo !== undefined
        ? await this.prisma.designDocumentVersion.findUnique({
            where: { documentId_versionNo: { documentId: doc.id, versionNo: input.versionNo } },
          })
        : doc.currentVersion;
    if (input.versionNo !== undefined && !version) throw invalid('versionNo', 'no such version');
    // @mentions: the owner and the active members of the design's company only.
    const mentionable = await this.mentionable(doc);
    const mentioned = [...new Set(input.mentions ?? [])].map((id, i) => {
      const user = mentionable.get(id);
      if (!user) throw invalid(`mentions[${i}]`, 'not a member of the design’s company');
      return user;
    });
    return this.prisma.withTx(async (tx) => {
      const row = await tx.designComment.create({
        data: {
          documentId: doc.id,
          versionId: version?.id ?? null,
          parentId: parent?.id ?? null,
          authorUserId: actor.userId,
          body: input.body.trim(),
          anchor: parent || !input.anchor ? undefined : anchorOf(input.anchor),
          mentionedUserIds: mentioned.map((m) => m.id),
        },
        include: COMMENT_INCLUDE,
      });
      // The owner hears of others' comments, every mentioned person of theirs (D-143 customer routes).
      if (doc.ownerUserId !== actor.userId)
        await this.event(tx, actor, doc.publicId, 'design.commented', {
          commentId: row.publicId,
          customerId: doc.owner.publicId,
          title: doc.title,
        });
      for (const m of mentioned.filter((x) => x.id !== actor.userId))
        await this.event(tx, actor, doc.publicId, 'design.comment_mentioned', {
          commentId: row.publicId,
          customerId: m.publicId,
          title: doc.title,
        });
      return row;
    });
  }

  async resolve(actor: UserActor, access: Access, commentId: string): Promise<CommentRow> {
    return this.prisma.withTx(async (tx) => {
      const comment = await tx.designComment.findFirst({
        where: { publicId: commentId, documentId: access.doc.id },
      });
      if (!comment) throw new DomainException('http.not_found');
      if (comment.parentId !== null) throw new DomainException('designs.comment_not_thread');
      if (!access.owner && !access.member && comment.authorUserId !== actor.userId)
        throw new DomainException('designs.share_scope');
      if (!comment.resolvedAt) {
        await tx.designComment.update({
          where: { id: comment.id },
          data: { resolvedAt: new Date(), resolvedById: actor.userId },
        });
        await this.event(tx, actor, access.doc.publicId, 'design.comment_resolved', { commentId });
      }
      return tx.designComment.findUniqueOrThrow({ where: { id: comment.id }, include: COMMENT_INCLUDE });
    });
  }

  /** The owner or an active member of the design's company. */
  async accessFor(actor: UserActor, designId: string): Promise<Access> {
    const doc = await this.designs.get(designId);
    const owner = doc.ownerUserId === actor.userId;
    const member = !owner && (await this.isMember(actor.userId, doc));
    if (!owner && !member) throw new DomainException('http.not_found');
    return { doc, owner, member, scope: null };
  }

  /** Through a link: what the link allows, plus membership when the holder belongs to the company. */
  async accessByToken(actor: UserActor | null, token: string): Promise<Access> {
    const { doc, scope } = await this.byToken(token);
    const owner = !!actor && doc.ownerUserId === actor.userId;
    const member = !!actor && !owner && (await this.isMember(actor.userId, doc));
    return { doc, owner, member, scope };
  }

  async userPublicIds(ids: bigint[]): Promise<Map<bigint, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, publicId: true },
    });
    return new Map(users.map((u) => [u.id, u.publicId]));
  }

  // --- helpers ----------------------------------------------------------------------------------------------

  private async isMember(userId: bigint, doc: { companyId: bigint | null }): Promise<boolean> {
    if (doc.companyId === null) return false;
    return (
      (await this.prisma.companyMember.count({
        where: { companyId: doc.companyId, userId, status: 'active' },
      })) > 0
    );
  }

  private async mentionable(doc: DesignRow): Promise<Map<string, { id: bigint; publicId: string }>> {
    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: doc.ownerUserId },
      select: { id: true, publicId: true },
    });
    const members = doc.companyId
      ? await this.prisma.companyMember.findMany({
          where: { companyId: doc.companyId, status: 'active' },
          select: { user: { select: { id: true, publicId: true } } },
        })
      : [];
    return new Map([owner, ...members.map((m) => m.user)].map((u) => [u.publicId, u]));
  }

  private async event(
    tx: Tx,
    actor: UserActor,
    designId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    await this.events.record(
      tx,
      { type, aggregateType: 'design_document', aggregateId: designId, payload: { designId, ...data } },
      actor,
    );
  }
}

/** Only the anchor's own coordinates are kept (a face's UV, or the flat's mm). */
function anchorOf(a: NonNullable<CommentInput['anchor']>): Prisma.InputJsonValue {
  return a.faceId !== undefined
    ? { faceId: a.faceId, u: a.u ?? 0, v: a.v ?? 0 }
    : { xMm: a.xMm ?? 0, yMm: a.yMm ?? 0 };
}
