import { CurrentActor, OptionalActor, Public } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { DESIGN_EXAMPLE, DesignDocumentDto, PatchDesignDocumentDto } from '@modules/designs/designs.dto';
import { designEtag, DesignsService } from '@modules/designs/designs.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  AddCommentDto,
  CommentDto,
  CreatedShareLinkDto,
  CreateShareLinkDto,
  ShareLinkDto,
  StudioCartItemRefDto,
} from './collaboration.dto';
import { CollaborationService, type CommentRow } from './collaboration.service';
import { StudioOrderDto } from './studio.dto';
import { StudioPrintService } from './studio-print.service';

const designParam = ApiParam({ name: 'designId', format: 'uuid' });
const tokenParam = ApiParam({ name: 'token', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } });
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const LINK_EXAMPLE: ShareLinkDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000fb01',
  scope: 'comment',
  expiresAt: '2026-10-18T10:00:00+07:00',
  revokedAt: null,
  createdAt: '2026-10-03T10:00:00+07:00',
};
const COMMENT_EXAMPLE: CommentDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000fc01',
  parentId: null,
  author: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000c002', displayName: 'Fake Member' },
  body: 'โลโก้เล็กไปนิด ขยายอีกหน่อยได้ไหม',
  anchor: { faceId: 'front', u: 0.42, v: 0.3 },
  mentions: [],
  versionNo: 3,
  resolvedAt: null,
  resolvedBy: null,
  createdAt: '2026-10-03T10:00:00+07:00',
};

function user(actor: Actor): UserActor {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
}

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

function commentDto(c: CommentRow, mentions: Map<bigint, string>): CommentDto {
  return {
    id: c.publicId,
    parentId: c.parent?.publicId ?? null,
    author: { id: c.author.publicId, displayName: c.author.displayName },
    body: c.body,
    anchor: (c.anchor as Record<string, unknown> | null) ?? null,
    mentions: c.mentionedUserIds.map((id) => mentions.get(id)).filter((x): x is string => !!x),
    versionNo: c.version?.versionNo ?? null,
    resolvedAt: c.resolvedAt ? toBangkokIso(c.resolvedAt) : null,
    resolvedBy: c.resolvedBy ? { id: c.resolvedBy.publicId, displayName: c.resolvedBy.displayName } : null,
    createdAt: toBangkokIso(c.createdAt),
  };
}

/**
 * D-285 / D-286 studio collaboration routes: scoped share links of my design, comments (mine, my company's, or
 * through a comment / edit link), editing through an edit link, and the design-service hand-off.
 */
@ApiSurface('store', 'studio')
@Controller('studio')
export class StoreStudioCollaborationController {
  constructor(
    private readonly collaboration: CollaborationService,
    private readonly designs: DesignsService,
    private readonly print: StudioPrintService,
  ) {}

  private async comments(rows: CommentRow[]): Promise<CommentDto[]> {
    const users = await this.collaboration.userPublicIds([
      ...new Set(rows.flatMap((r) => r.mentionedUserIds)),
    ]);
    return rows.map((r) => commentDto(r, users));
  }

  @Post(':designId/share-links')
  @designParam
  @ApiEndpoint({
    id: 'store.studio.createShareLink',
    summary: 'Share my design with a scope',
    description:
      'A new link (many may live at once): `view`, `comment` (signed-in users comment) or `edit` (signed-in members ' +
      'of the design’s company edit). The token is shown once and stored hashed; it expires after ' +
      '`configurations.share_link_days` and can be revoked (D-285, D-185).',
    implements: ['D-285', 'D-185'],
  })
  @ApiBody({ type: CreateShareLinkDto, examples: { default: { value: { scope: 'comment' } } } })
  @ApiSuccess(201, {
    description: 'Link (with its token, once)',
    type: CreatedShareLinkDto,
    example: { ...LINK_EXAMPLE, token: 'q3Rk0J7d3n2h8xJm1v5yW0b2C4e6G8i0K2m4O6q8S0u' },
  })
  @ApiStandardErrors(...WRITE)
  async createLink(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: CreateShareLinkDto,
  ): Promise<CreatedShareLinkDto> {
    const { link, token } = await this.collaboration.createLink(customer(actor), designId, body.scope);
    return {
      id: link.publicId,
      scope: link.scope,
      expiresAt: toBangkokIso(link.expiresAt),
      revokedAt: null,
      createdAt: toBangkokIso(link.createdAt),
      token,
    };
  }

  @Get(':designId/share-links')
  @designParam
  @ApiEndpoint({
    id: 'store.studio.listShareLinks',
    summary: 'My design’s share links',
    description: 'Every link with its scope, expiry and revocation — never the tokens (D-285).',
    implements: ['D-285'],
  })
  @ApiSuccess(200, { description: 'Links', type: [ShareLinkDto], example: [LINK_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async links(@CurrentActor() actor: Actor, @Param('designId', ParseUUIDPipe) designId: string) {
    return (await this.collaboration.links(customer(actor), designId)).map((l) => ({
      id: l.publicId,
      scope: l.scope,
      expiresAt: toBangkokIso(l.expiresAt),
      revokedAt: l.revokedAt ? toBangkokIso(l.revokedAt) : null,
      createdAt: toBangkokIso(l.createdAt),
    }));
  }

  @Post(':designId/share-links/:linkId/actions/revoke')
  @HttpCode(204)
  @designParam
  @ApiParam({ name: 'linkId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.studio.revokeShareLink',
    summary: 'Revoke a share link',
    description: 'It stops opening at once (D-285).',
    implements: ['D-285'],
  })
  @ApiSuccess(204, { description: 'Revoked' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async revoke(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ): Promise<void> {
    await this.collaboration.revokeLink(customer(actor), designId, linkId);
  }

  @Get(':designId/comments')
  @designParam
  @ApiEndpoint({
    id: 'store.studio.listComments',
    summary: 'Comments on my (company’s) design',
    description: 'Threads anchored to the 3D box or the flat, oldest first (D-285).',
    implements: ['D-285'],
  })
  @ApiSuccess(200, { description: 'Comments', type: [CommentDto], example: [COMMENT_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listComments(@CurrentActor() actor: Actor, @Param('designId', ParseUUIDPipe) designId: string) {
    const access = await this.collaboration.accessFor(user(actor), designId);
    return this.comments(await this.collaboration.comments(access));
  }

  @Post(':designId/comments')
  @designParam
  @ApiEndpoint({
    id: 'store.studio.addComment',
    summary: 'Comment on my (company’s) design',
    description:
      'Anchored to a face (`faceId` + UV) or a point on the flat (mm), or a reply to a thread; @mentions of the ' +
      'owner and the company’s members are notified (D-285).',
    implements: ['D-285'],
  })
  @ApiBody({
    type: AddCommentDto,
    examples: {
      default: { value: { body: COMMENT_EXAMPLE.body, anchor: { faceId: 'front', u: 0.42, v: 0.3 } } },
    },
  })
  @ApiSuccess(201, { description: 'Comment', type: CommentDto, example: COMMENT_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async addComment(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: AddCommentDto,
  ): Promise<CommentDto> {
    const me = user(actor);
    const access = await this.collaboration.accessFor(me, designId);
    return (await this.comments([await this.collaboration.addComment(me, access, body)]))[0]!;
  }

  @Post(':designId/comments/:commentId/actions/resolve')
  @HttpCode(200)
  @designParam
  @ApiParam({ name: 'commentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.studio.resolveComment',
    summary: 'Resolve a comment thread',
    description: 'By the owner, a company member or the thread’s author; once (D-285).',
    implements: ['D-285'],
  })
  @ApiSuccess(200, {
    description: 'Comment',
    type: CommentDto,
    example: {
      ...COMMENT_EXAMPLE,
      resolvedAt: '2026-10-03T11:00:00+07:00',
      resolvedBy: COMMENT_EXAMPLE.author,
    },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'designs.comment_not_thread',
    'designs.share_scope',
  )
  async resolve(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<CommentDto> {
    const me = user(actor);
    const access = await this.collaboration.accessFor(me, designId);
    return (await this.comments([await this.collaboration.resolve(me, access, commentId)]))[0]!;
  }

  @Get('shared/:token/comments')
  @Public()
  @tokenParam
  @ApiEndpoint({
    id: 'store.studio.listSharedComments',
    summary: 'Comments through a share link',
    description: 'With a comment or edit link (D-285).',
    implements: ['D-285'],
  })
  @ApiSuccess(200, { description: 'Comments', type: [CommentDto], example: [COMMENT_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'designs.share_scope')
  async sharedComments(@OptionalActor() actor: Actor | undefined, @Param('token') token: string) {
    const me = actor?.type === 'user' ? actor : null;
    const access = await this.collaboration.accessByToken(me, token);
    return this.comments(await this.collaboration.comments(access));
  }

  @Post('shared/:token/comments')
  @tokenParam
  @ApiEndpoint({
    id: 'store.studio.addSharedComment',
    summary: 'Comment through a share link',
    description: 'A signed-in user with a comment or edit link (D-285).',
    implements: ['D-285'],
  })
  @ApiBody({ type: AddCommentDto, examples: { default: { value: { body: COMMENT_EXAMPLE.body } } } })
  @ApiSuccess(201, { description: 'Comment', type: CommentDto, example: COMMENT_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'designs.share_scope')
  async addSharedComment(
    @CurrentActor() actor: Actor,
    @Param('token') token: string,
    @Body() body: AddCommentDto,
  ): Promise<CommentDto> {
    const me = user(actor);
    const access = await this.collaboration.accessByToken(me, token);
    return (await this.comments([await this.collaboration.addComment(me, access, body)]))[0]!;
  }

  @Patch('shared/:token/document')
  @tokenParam
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'store.studio.editShared',
    summary: 'Edit a design through an edit link',
    description:
      'A JSON Patch like `store.designs.patchDocument`, for a signed-in member of the design’s company holding an ' +
      'edit link (ETag from `store.designs.getShared`) (D-285, D-276).',
    implements: ['D-285', 'D-276'],
  })
  @ApiBody({
    type: PatchDesignDocumentDto,
    examples: { default: { value: { operations: [{ op: 'replace', path: '/title', value: 'แก้ไข' }] } } },
  })
  @ApiSuccess(200, { description: 'Saved', type: DesignDocumentDto, example: DESIGN_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'designs.share_scope', 'designs.patch_failed', 'designs.patch_too_large')
  async editShared(
    @CurrentActor() actor: Actor,
    @Param('token') token: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: PatchDesignDocumentDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DesignDocumentDto> {
    const row = await this.collaboration.editShared(user(actor), token, ifMatch, body);
    res.setHeader('ETag', designEtag(row));
    return this.designs.view(row);
  }

  @Post(':designId/design-service')
  @designParam
  @ApiEndpoint({
    id: 'store.studio.requestDesignService',
    summary: 'Hand my design to the design service',
    description:
      '“ให้ทีมออกแบบให้”: the version goes in the cart with the design service, priced by its studio quotation with ' +
      'the graphic design fee; at checkout the design-service request works on this design — its brief starts from ' +
      'it and the assigned designer may edit this document only (D-286).',
    implements: ['D-286', 'D-071'],
  })
  @ApiBody({
    type: StudioOrderDto,
    examples: {
      default: {
        value: {
          quoteId: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
          quoteOptionId: '0192f3a0-7c1e-7d2a-9b1f-00000000a202',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'In the cart',
    type: StudioCartItemRefDto,
    example: { cartItemId: '0192f3a0-7c1e-7d2a-9b1f-00000000c901', designVersionNo: 3 },
  })
  @ApiStandardErrors(
    ...WRITE,
    'designs.version_required',
    'studio.quote_not_of_version',
    'cart.design_option_unavailable',
    'cart.item_exists',
  )
  async designService(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: StudioOrderDto,
  ): Promise<StudioCartItemRefDto> {
    return this.print.handOff(customer(actor), designId, body);
  }
}
