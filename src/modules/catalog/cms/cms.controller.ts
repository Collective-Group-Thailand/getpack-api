import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { type Response } from 'express';

import { staffActor } from '../crud/catalog-crud.controller';
import { CatalogCrudService, rowEtag } from '../crud/catalog-crud.service';
import { type AnyCatalogResource, type CrudRow } from '../crud/catalog-resource';
import { RefResolver } from '../crud/ref-resolver';
import {
  ReplaceColoursDto,
  ReplaceFontsDto,
  SemiDesignDto,
  SemiDesignTemplateDto,
  SHOWCASE_IDS,
} from '../showcase/showcase.dto';
import { semiDesigns, semiDesignTemplates } from '../showcase/showcase.resources';
import { ArticleDto, CMS_IDS, HomeSectionDto, ReorderDto, ReplaceArticleCategoriesDto } from './cms.dto';
import { ARTICLE_EXAMPLE, articles, homeSections } from './cms.resources';

const ERRORS = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;

async function resolveAll(
  refs: RefResolver,
  model: 'articleCategory' | 'designFont',
  ids: string[],
  path: string,
) {
  if (new Set(ids).size !== ids.length) {
    throw new DomainException('validation.failed', {
      errors: [{ path, code: 'unique', message: `${path} lists the same item twice` }],
    });
  }
  const resolved: bigint[] = [];
  for (const [index, id] of ids.entries()) resolved.push(await refs.id(model, id, `${path}[${index}]`));
  return resolved;
}

/** Decorated so its constructor parameters are emitted for the subclasses' injection. */
@Injectable()
abstract class ChildrenController {
  constructor(protected readonly crud: CatalogCrudService) {}

  protected async respond(resource: AnyCatalogResource, row: CrudRow, res: Response): Promise<object> {
    res.setHeader('ETag', rowEtag(row));
    const [dto] = await this.crud.toDtos(resource, [row]);
    return dto!;
  }
}

@ApiSurface('admin', 'cmsHomeSections')
@Controller('cms/home-sections')
export class HomeSectionActionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crud: CatalogCrudService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  @Post('actions/reorder')
  @HttpCode(200)
  @Can('cms.manage')
  @ApiEndpoint({
    id: 'admin.cmsHomeSections.reorder',
    summary: 'Reorder the home-page sections',
    description:
      'The body lists every (not deleted) section once in the new order; `sort` becomes 10, 20, 30 … ' +
      'Audited and published as `catalog.home_section.reordered`.',
    implements: ['D-005'],
  })
  @ApiBody({ type: ReorderDto, examples: { default: { value: { ids: [CMS_IDS.section] } } } })
  @ApiSuccess(200, {
    description: 'Sections in their new order',
    type: [HomeSectionDto],
    example: [homeSections.example],
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async reorder(@CurrentActor() actor: Actor, @Body() body: ReorderDto): Promise<object[]> {
    const user = staffActor(actor);
    const rows = await this.prisma.withTx(async (tx) => {
      const sections = await tx.homeSection.findMany({
        where: { deletedAt: null },
        select: { id: true, publicId: true },
      });
      const known = new Map(sections.map((s) => [s.publicId, s.id]));
      if (
        body.ids.length !== sections.length ||
        new Set(body.ids).size !== body.ids.length ||
        !body.ids.every((id) => known.has(id))
      ) {
        throw new DomainException('validation.failed', {
          errors: [{ path: 'ids', code: 'complete', message: 'ids must list every section exactly once' }],
        });
      }
      for (const [index, id] of body.ids.entries()) {
        await tx.homeSection.update({
          where: { id: known.get(id)! },
          data: { sort: (index + 1) * 10, updatedById: user.userId, rowVersion: { increment: 1 } },
        });
      }
      await this.audit.record(tx, {
        category: 'config',
        action: 'catalog.home_sections_reordered',
        resourceType: 'home_section',
        data: { order: body.ids },
      });
      await this.events.record(tx, {
        type: 'catalog.home_section.reordered',
        aggregateType: 'home_section',
        aggregateId: body.ids[0] ?? '00000000-0000-0000-0000-000000000000',
        payload: { order: body.ids },
      });
      return tx.homeSection.findMany({ where: { deletedAt: null }, orderBy: { sort: 'asc' } });
    });
    return this.crud.toDtos(homeSections, rows);
  }
}

@ApiSurface('admin', 'cmsArticles')
@Controller('cms/articles')
export class ArticleActionsController extends ChildrenController {
  @Put(':id/categories')
  @Can('cms.manage')
  @ApiEndpoint({
    id: 'admin.cmsArticles.replaceCategories',
    summary: 'Replace the categories of an article',
    description: 'The whole list is replaced; guarded by the article ETag.',
    implements: ['D-005'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReplaceArticleCategoriesDto,
    examples: { default: { value: { categoryIds: [CMS_IDS.articleCategory] } } },
  })
  @ApiSuccess(200, { description: 'The article', type: ArticleDto, example: ARTICLE_EXAMPLE })
  @ApiStandardErrors(...ERRORS)
  async replaceCategories(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplaceArticleCategoriesDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    const user = staffActor(actor);
    const row = await this.crud.mutateChildren(
      articles,
      user,
      id,
      ifMatch,
      ['categoryIds'],
      async (tx, article) => {
        const ids = await resolveAll(new RefResolver(tx), 'articleCategory', body.categoryIds, 'categoryIds');
        await tx.articleCategoryLink.deleteMany({ where: { articleId: article.id } });
        await tx.articleCategoryLink.createMany({
          data: ids.map((categoryId) => ({ articleId: article.id, categoryId, createdById: user.userId })),
        });
      },
    );
    return this.respond(articles, row, res);
  }
}

@ApiSurface('admin', 'catalogSemiDesigns')
@Controller('catalog/semi-designs')
export class SemiDesignActionsController extends ChildrenController {
  @Put(':id/colours')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogSemiDesigns.replaceColours',
    summary: 'Replace the palette of a semi-design',
    description: 'Colours as `#RRGGBB`, each once, in display order; guarded by the semi-design ETag.',
    implements: ['D-005'],
  })
  @ApiConcurrency()
  @ApiBody({ type: ReplaceColoursDto, examples: { default: { value: { colours: ['#000000', '#FFFFFF'] } } } })
  @ApiSuccess(200, { description: 'The semi-design', type: SemiDesignDto, example: semiDesigns.example })
  @ApiStandardErrors(...ERRORS)
  async replaceColours(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplaceColoursDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    const user = staffActor(actor);
    const hexes = body.colours.map((c) => c.toUpperCase());
    if (new Set(hexes).size !== hexes.length) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'colours', code: 'unique', message: 'colours lists the same colour twice' }],
      });
    }
    const row = await this.crud.mutateChildren(
      semiDesigns,
      user,
      id,
      ifMatch,
      ['colours'],
      async (tx, design) => {
        await tx.semiDesignColour.deleteMany({ where: { semiDesignId: design.id } });
        await tx.semiDesignColour.createMany({
          data: hexes.map((hex, sort) => ({ semiDesignId: design.id, hex, sort, createdById: user.userId })),
        });
      },
    );
    return this.respond(semiDesigns, row, res);
  }
}

@ApiSurface('admin', 'catalogSemiDesignTemplates')
@Controller('catalog/semi-design-templates')
export class SemiDesignTemplateActionsController extends ChildrenController {
  @Put(':id/fonts')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogSemiDesignTemplates.replaceFonts',
    summary: 'Replace the fonts of a semi-design template',
    description: 'The whole list is replaced; guarded by the template ETag.',
    implements: ['D-005'],
  })
  @ApiConcurrency()
  @ApiBody({ type: ReplaceFontsDto, examples: { default: { value: { fontIds: [SHOWCASE_IDS.font] } } } })
  @ApiSuccess(200, {
    description: 'The template',
    type: SemiDesignTemplateDto,
    example: semiDesignTemplates.example,
  })
  @ApiStandardErrors(...ERRORS)
  async replaceFonts(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplaceFontsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    const user = staffActor(actor);
    const row = await this.crud.mutateChildren(
      semiDesignTemplates,
      user,
      id,
      ifMatch,
      ['fontIds'],
      async (tx, template) => {
        const ids = await resolveAll(new RefResolver(tx), 'designFont', body.fontIds, 'fontIds');
        await tx.semiDesignTemplateFont.deleteMany({ where: { templateId: template.id } });
        await tx.semiDesignTemplateFont.createMany({
          data: ids.map((fontId) => ({ templateId: template.id, fontId, createdById: user.userId })),
        });
      },
    );
    return this.respond(semiDesignTemplates, row, res);
  }
}
