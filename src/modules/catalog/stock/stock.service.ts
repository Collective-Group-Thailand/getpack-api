import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { CatalogCrudService, rowEtag } from '../crud/catalog-crud.service';
import { jsonField } from '../crud/compact';
import { orderedImages, uploadedPhotoVariant } from '../crud/image-order';
import { RefResolver } from '../crud/ref-resolver';
import { type AddStockImageDto, type ReorderImagesDto, type ReplaceStockAttributesDto } from './stock.dto';
import { type StockProductRow, stockProducts } from './stock.resources';

/** Attributes and images of a stock product; each change bumps the product's ETag (one transaction). */
@Injectable()
export class StockProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crud: CatalogCrudService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  replaceAttributes(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: ReplaceStockAttributesDto,
  ) {
    return this.onProduct(actor, publicId, ifMatch, 'attributes', async (tx, product) => {
      const attributes = input.attributes.map((a) => a.attribute);
      if (new Set(attributes).size !== attributes.length) {
        throw new DomainException('validation.failed', {
          errors: [{ path: 'attributes', code: 'unique', message: 'each attribute may be set once' }],
        });
      }
      const rows = [];
      for (const [index, item] of input.attributes.entries()) {
        const value = await tx.stockAttributeValue.findFirst({
          where: { publicId: item.valueId, attribute: item.attribute },
          select: { id: true },
        });
        if (!value) {
          throw new DomainException('validation.failed', {
            errors: [
              {
                path: `attributes[${index}].valueId`,
                code: 'exists',
                message: `no ${item.attribute} value with this id`,
              },
            ],
          });
        }
        rows.push({
          stockProductId: product.id,
          attribute: item.attribute,
          valueId: value.id,
          createdById: actor.userId,
        });
      }
      await tx.stockProductAttribute.deleteMany({ where: { stockProductId: product.id } });
      await tx.stockProductAttribute.createMany({ data: rows });
    });
  }

  addImage(actor: UserActor, publicId: string, ifMatch: string | undefined, input: AddStockImageDto) {
    return this.onProduct(actor, publicId, ifMatch, 'images', async (tx, product) => {
      const fileObjectId = await new RefResolver(tx).file(input.fileId, 'fileId');
      if (input.sort === undefined)
        await tx.stockProductImage.updateMany({
          where: { stockProductId: product.id },
          data: { sort: { increment: 1 } },
        });
      await tx.stockProductImage.create({
        data: {
          stockProductId: product.id,
          fileObjectId,
          variant: jsonField(uploadedPhotoVariant(null)),
          sort: input.sort ?? 0,
          createdById: actor.userId,
        },
      });
    });
  }

  reorderImages(actor: UserActor, publicId: string, ifMatch: string | undefined, input: ReorderImagesDto) {
    return this.onProduct(actor, publicId, ifMatch, 'images', async (tx, product) => {
      const ordered = orderedImages(product.images, input.imageIds);
      for (const [sort, image] of ordered.entries())
        await tx.stockProductImage.update({ where: { id: image.id }, data: { sort } });
    });
  }

  removeImage(actor: UserActor, publicId: string, imageId: string, ifMatch: string | undefined) {
    return this.onProduct(actor, publicId, ifMatch, 'images', async (tx, product) => {
      const image = product.images.find((i) => i.publicId === imageId);
      if (!image) throw new DomainException('http.not_found');
      await tx.stockProductImage.delete({ where: { id: image.id } });
    });
  }

  private onProduct(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    field: string,
    work: (tx: Tx, product: StockProductRow) => Promise<void>,
  ) {
    return this.prisma.withTx(async (tx) => {
      const product = (await this.crud.get(stockProducts, publicId, tx)) as unknown as StockProductRow;
      assertIfMatch(ifMatch, rowEtag(product));
      await work(tx, product);
      await tx.stockProduct.update({
        where: { id: product.id },
        data: { updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'catalog.stock_product_updated',
        resourceType: 'stock_product',
        resourcePublicId: publicId,
        data: { fields: [field] },
      });
      await this.events.record(tx, {
        type: 'catalog.stock_product.updated',
        aggregateType: 'stock_product',
        aggregateId: publicId,
        payload: { id: publicId, fields: [field] },
      });
      return this.crud.get(stockProducts, publicId, tx);
    });
  }
}
