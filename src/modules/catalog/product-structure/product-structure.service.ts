import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma, type QuoteMode } from '@generated/prisma/client';
import { assertStoreRules, validateConfiguration } from '@modules/pricing/quotes/configurations';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { CatalogCrudService, rowEtag } from '../crud/catalog-crud.service';
import { jsonField } from '../crud/compact';
import { RefResolver } from '../crud/ref-resolver';
import { resolveOptionIds } from './option-refs';
import { type AddImageDto, type ReplaceOptionsDto, type ReplacePatternsDto } from './product-structure.dto';
import {
  type CatalogProductRow,
  catalogProducts,
  patterns as patternResource,
  productTypes,
} from './product-structure.resources';
import { SHIPPED_CALCULATORS } from './shipped-calculators';

/**
 * Product-structure actions beyond plain CRUD: quote-mode switch (D-100) and the child collections of
 * a catalogue product and a pattern. Each replaces the collection in one transaction, bumps the
 * parent's `row_version` (so its ETag changes), writes an audit row and a domain event.
 */
/** Calculators whose configuration can be a price-hint reference (D-220): the ported ones. */
const REFERENCE_CALCULATORS: ReadonlySet<string> = new Set(['folding', 'corrugate', 'label']);

@Injectable()
export class ProductStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crud: CatalogCrudService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async changeQuoteMode(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: { quoteMode: QuoteMode; reason: string },
  ) {
    return this.prisma.withTx(async (tx) => {
      const current = await tx.productType.findUnique({ where: { publicId } });
      if (!current) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, rowEtag(current));
      if (current.quoteMode === input.quoteMode) return this.crud.get(productTypes, publicId, tx);
      if (
        input.quoteMode === 'instant' &&
        (current.calculatorKey === null || !SHIPPED_CALCULATORS.has(current.calculatorKey))
      ) {
        throw new DomainException('catalog.calculator_required');
      }
      await tx.productType.update({
        where: { id: current.id },
        data: { quoteMode: input.quoteMode, updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      const change = {
        code: current.code,
        from: current.quoteMode,
        to: input.quoteMode,
        reason: input.reason,
      };
      await this.audit.record(tx, {
        category: 'config',
        action: 'catalog.product_type_quote_mode_changed',
        resourceType: 'product_type',
        resourcePublicId: publicId,
        data: change,
      });
      await this.events.record(tx, {
        type: 'product_type.quote_mode_changed',
        aggregateType: 'product_type',
        aggregateId: publicId,
        payload: { id: publicId, ...change },
      });
      return this.crud.get(productTypes, publicId, tx);
    });
  }

  async replacePatterns(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: ReplacePatternsDto,
  ) {
    return this.onCatalogProduct(actor, publicId, ifMatch, 'patterns', async (tx, product) => {
      const refs = new RefResolver(tx);
      const rows = [];
      for (const [index, link] of input.patterns.entries()) {
        rows.push({
          catalogProductId: product.id,
          patternId: await refs.id('pattern', link.patternId, `patterns[${index}].patternId`),
          factorNw: link.factorNw ?? null,
          factorNl: link.factorNl ?? null,
          factorNd: link.factorNd ?? null,
          sort: link.sort ?? index,
          createdById: actor.userId,
        });
      }
      duplicates(
        rows.map((r) => String(r.patternId)),
        'patterns',
      );
      await tx.catalogProductPattern.deleteMany({ where: { catalogProductId: product.id } });
      await tx.catalogProductPattern.createMany({ data: rows });
    });
  }

  /**
   * D-220: the configuration a product's "starting from" price is quoted at — validated as a store request of its
   * type's calculator (DTO and store rules, one quantity), or cleared with `null`.
   */
  async setReferenceConfiguration(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    configuration: Record<string, unknown> | null,
  ) {
    return this.onCatalogProduct(actor, publicId, ifMatch, 'referenceConfiguration', async (tx, product) => {
      let value: Record<string, unknown> | null = null;
      if (configuration !== null) {
        const type = await tx.productType.findFirstOrThrow({
          where: { catalogProducts: { some: { id: product.id } } },
          select: { calculatorKey: true },
        });
        const fail = (path: string, message: string): never => {
          throw new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
        };
        if (!type.calculatorKey || !REFERENCE_CALCULATORS.has(type.calculatorKey)) {
          fail('configuration', 'the product type has no ported calculator to price a reference with');
        }
        value = await validateConfiguration(
          type.calculatorKey!,
          { ...configuration, catalogProductId: publicId },
          { staff: false },
        );
        const quantities = value['quantities'];
        if (!Array.isArray(quantities) || quantities.length !== 1) {
          fail('configuration.quantities', 'a reference configuration names exactly one quantity');
        }
        await assertStoreRules(tx, type.calculatorKey!, value);
      }
      await tx.catalogProduct.update({
        where: { id: product.id },
        data: { referenceConfiguration: value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue) },
      });
    });
  }

  async replaceOptions(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: ReplaceOptionsDto,
  ) {
    return this.onCatalogProduct(actor, publicId, ifMatch, 'options', async (tx, product) => {
      const ids = await resolveOptionIds(tx, input.options, 'options');
      duplicates(
        input.options.map((o, i) => `${o.kind}:${ids[i]}`),
        'options',
      );
      await tx.catalogProductOption.deleteMany({ where: { catalogProductId: product.id } });
      await tx.catalogProductOption.createMany({
        data: input.options.map((o, i) => ({
          catalogProductId: product.id,
          optionKind: o.kind,
          optionId: ids[i]!,
          isDefault: o.isDefault ?? false,
          sort: o.sort ?? i,
          createdById: actor.userId,
        })),
      });
    });
  }

  async addImage(actor: UserActor, publicId: string, ifMatch: string | undefined, input: AddImageDto) {
    return this.onCatalogProduct(actor, publicId, ifMatch, 'images', async (tx, product) => {
      const fileObjectId = await new RefResolver(tx).file(input.fileId, 'fileId');
      await tx.catalogProductImage.create({
        data: {
          catalogProductId: product.id,
          fileObjectId,
          variant: jsonField(input.variant),
          sort: input.sort ?? product.images.length,
          createdById: actor.userId,
        },
      });
    });
  }

  async removeImage(actor: UserActor, publicId: string, imageId: string, ifMatch: string | undefined) {
    return this.onCatalogProduct(actor, publicId, ifMatch, 'images', async (tx, product) => {
      const image = product.images.find((i) => i.publicId === imageId);
      if (!image) throw new DomainException('http.not_found');
      await tx.catalogProductImage.delete({ where: { id: image.id } });
    });
  }

  async replaceFluteTypes(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    fluteTypeIds: string[],
  ) {
    return this.prisma.withTx(async (tx) => {
      const pattern = await this.crud.get(patternResource, publicId, tx);
      assertIfMatch(ifMatch, rowEtag(pattern));
      const refs = new RefResolver(tx);
      const ids: bigint[] = [];
      for (const [index, id] of fluteTypeIds.entries()) {
        ids.push(await refs.id('fluteType', id, `fluteTypeIds[${index}]`));
      }
      duplicates(ids.map(String), 'fluteTypeIds');
      await tx.patternFluteType.deleteMany({ where: { patternId: pattern.id } });
      await tx.patternFluteType.createMany({
        data: ids.map((fluteTypeId) => ({ patternId: pattern.id, fluteTypeId, createdById: actor.userId })),
      });
      await tx.pattern.update({
        where: { id: pattern.id },
        data: { updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.changed(tx, 'pattern', publicId, ['fluteTypeIds']);
      return this.crud.get(patternResource, publicId, tx);
    });
  }

  private async onCatalogProduct(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    field: string,
    work: (tx: Tx, product: CatalogProductRow) => Promise<void>,
  ) {
    return this.prisma.withTx(async (tx) => {
      const product = (await this.crud.get(catalogProducts, publicId, tx)) as unknown as CatalogProductRow;
      assertIfMatch(ifMatch, rowEtag(product));
      await work(tx, product);
      await tx.catalogProduct.update({
        where: { id: product.id },
        data: { updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.changed(tx, 'catalog_product', publicId, [field]);
      return this.crud.get(catalogProducts, publicId, tx);
    });
  }

  private async changed(tx: Tx, key: string, publicId: string, fields: string[]): Promise<void> {
    await this.audit.record(tx, {
      category: 'config',
      action: `catalog.${key}_updated`,
      resourceType: key,
      resourcePublicId: publicId,
      data: { fields },
    });
    await this.events.record(tx, {
      type: `catalog.${key}.updated`,
      aggregateType: key,
      aggregateId: publicId,
      payload: { id: publicId, fields },
    });
  }
}

/** A collection may list each item once (422 on the collection path otherwise). */
function duplicates(keys: string[], path: string): void {
  if (new Set(keys).size !== keys.length) {
    throw new DomainException('validation.failed', {
      errors: [{ path, code: 'unique', message: `${path} lists the same item twice` }],
    });
  }
}
