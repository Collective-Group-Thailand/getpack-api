import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toSkipTake } from '@common/pagination/pagination';
import { PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { StoreArticleCategoryDto } from '@modules/catalog/store/store-catalog.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Injectable, Param, Query } from '@nestjs/common';
import { ApiParam, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const DECISIONS = ['D-295'];

export class KnowledgeArticleCardDto {
  @ApiProperty({ example: 'qc-photo-standard' })
  slug!: string;

  @ApiProperty({ example: 'มาตรฐานภาพถ่าย QC' })
  titleTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'QC photo standard' })
  titleEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ถ่ายภาพงานก่อนส่งอย่างไรให้ Packio ตรวจได้' })
  excerptTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'How to photograph a job so Packio can check it' })
  excerptEn!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T09:00:00+07:00' })
  publishedAt!: string;

  @ApiProperty({ type: [String], example: ['qc-photo-standard'] })
  categorySlugs!: string[];
}

export class KnowledgeArticleDto extends KnowledgeArticleCardDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { th: { type: 'doc', content: [] } },
    description: 'Rich text per language (versioned schema, `bodySchemaVersion`)',
  })
  body!: Record<string, unknown>;

  @ApiProperty({ type: 'integer', example: 1 })
  bodySchemaVersion!: number;
}

const CARD: KnowledgeArticleCardDto = {
  slug: 'qc-photo-standard',
  titleTh: 'มาตรฐานภาพถ่าย QC',
  titleEn: 'QC photo standard',
  excerptTh: 'ถ่ายภาพงานก่อนส่งอย่างไรให้ Packio ตรวจได้',
  excerptEn: 'How to photograph a job so Packio can check it',
  publishedAt: '2026-10-03T09:00:00+07:00',
  categorySlugs: ['qc-photo-standard'],
};

export class KnowledgeArticleQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'qc-photo-standard', description: 'A category slug' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{1,120}$/)
  category?: string;
}

const INCLUDE = {
  categories: {
    where: { category: { status: 'published', audience: 'partner' } },
    include: { category: { select: { slug: true } } },
  },
} satisfies Prisma.ArticleInclude;
type Row = Prisma.ArticleGetPayload<{ include: typeof INCLUDE }>;

/** D-295 the partner knowledge base: published `partner` articles and categories, for partner users only. */
@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly prisma: PrismaService) {}

  private where(now = new Date()): Prisma.ArticleWhereInput {
    return { status: 'published', audience: 'partner', deletedAt: null, publishedAt: { lte: now } };
  }

  async categories(): Promise<StoreArticleCategoryDto[]> {
    const rows = await this.prisma.articleCategory.findMany({
      where: { status: 'published', audience: 'partner' },
      orderBy: [{ sort: 'asc' }, { slug: 'asc' }],
    });
    return rows.map((c) => ({ slug: c.slug, nameTh: c.nameTh, nameEn: c.nameEn }));
  }

  async articles(query: KnowledgeArticleQuery): Promise<{ rows: KnowledgeArticleCardDto[]; total: number }> {
    const where: Prisma.ArticleWhereInput = {
      ...this.where(),
      ...(query.category && {
        categories: {
          some: { category: { slug: query.category, status: 'published', audience: 'partner' } },
        },
      }),
      ...(query.q && {
        OR: [
          { titleTh: { contains: query.q, mode: 'insensitive' } },
          { titleEn: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.article.count({ where }),
    ]);
    return { rows: rows.map(card), total };
  }

  async article(slug: string): Promise<KnowledgeArticleDto> {
    const a = await this.prisma.article.findFirst({ where: { slug, ...this.where() }, include: INCLUDE });
    if (!a) throw new DomainException('http.not_found');
    return { ...card(a), body: a.body as Record<string, unknown>, bodySchemaVersion: a.bodySchemaVersion };
  }
}

function card(a: Row): KnowledgeArticleCardDto {
  return {
    slug: a.slug,
    titleTh: a.titleTh,
    titleEn: a.titleEn,
    excerptTh: a.excerptTh,
    excerptEn: a.excerptEn,
    publishedAt: toBangkokIso(a.publishedAt!),
    categorySlugs: a.categories.map((c) => c.category.slug),
  };
}

/** Any signed-in partner user (`aud=partner`) reads it; the store never serves these articles (D-295). */
@ApiSurface('partner', 'knowledgeBase')
@Controller('knowledge-base')
export class PartnerKnowledgeBaseController {
  constructor(private readonly kb: KnowledgeBaseService) {}

  @Get('categories')
  @ApiEndpoint({
    id: 'partner.knowledgeBase.listCategories',
    summary: 'Knowledge-base categories',
    description:
      'Published partner categories — print spec, file handling, QC photo standard, packing & labels, payouts (D-295).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Categories',
    type: [StoreArticleCategoryDto],
    example: [{ slug: 'qc-photo-standard', nameTh: 'มาตรฐานภาพถ่าย QC', nameEn: 'QC photo standard' }],
  })
  @ApiStandardErrors()
  categories() {
    return this.kb.categories();
  }

  @Get('articles')
  @ApiEndpoint({
    id: 'partner.knowledgeBase.listArticles',
    summary: 'Knowledge-base articles',
    description: 'Published partner articles, newest first; by category and title words (D-295).',
    implements: DECISIONS,
  })
  @ApiPaginated(KnowledgeArticleCardDto, { example: CARD })
  @ApiStandardErrors('validation.failed')
  async articles(@Query() q: KnowledgeArticleQuery) {
    const { rows, total } = await this.kb.articles(q);
    return { data: rows, meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('articles/:slug')
  @ApiParam({ name: 'slug', example: 'qc-photo-standard' })
  @ApiEndpoint({
    id: 'partner.knowledgeBase.getArticle',
    summary: 'A knowledge-base article',
    description: 'One published partner article with its body, Thai / English (D-295).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Article',
    type: KnowledgeArticleDto,
    example: { ...CARD, body: { th: { type: 'doc', content: [] } }, bodySchemaVersion: 1 },
  })
  @ApiStandardErrors('http.not_found')
  article(@Param('slug') slug: string) {
    return this.kb.article(slug);
  }
}
