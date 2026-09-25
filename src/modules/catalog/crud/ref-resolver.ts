import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';

/** Models addressed by public id from catalogue payloads. */
const MODELS = {
  productCategory: (tx: Tx) => tx.productCategory,
  productType: (tx: Tx) => tx.productType,
  printType: (tx: Tx) => tx.printType,
  catalogProduct: (tx: Tx) => tx.catalogProduct,
  pattern: (tx: Tx) => tx.pattern,
  materialFamily: (tx: Tx) => tx.materialFamily,
  fluteType: (tx: Tx) => tx.fluteType,
  material: (tx: Tx) => tx.material,
  finishGroup: (tx: Tx) => tx.finishGroup,
  finish: (tx: Tx) => tx.finish,
  inkColourGroup: (tx: Tx) => tx.inkColourGroup,
  inkColour: (tx: Tx) => tx.inkColour,
  diecutGroup: (tx: Tx) => tx.diecutGroup,
  diecutType: (tx: Tx) => tx.diecutType,
  assemblyGroup: (tx: Tx) => tx.assemblyGroup,
  assembly: (tx: Tx) => tx.assembly,
  difficultyLevelGroup: (tx: Tx) => tx.difficultyLevelGroup,
  difficultyLevel: (tx: Tx) => tx.difficultyLevel,
  stockProduct: (tx: Tx) => tx.stockProduct,
  stockAttributeValue: (tx: Tx) => tx.stockAttributeValue,
  standardSize: (tx: Tx) => tx.standardSize,
  showcaseCategory: (tx: Tx) => tx.showcaseCategory,
  showcaseProduct: (tx: Tx) => tx.showcaseProduct,
  semiDesign: (tx: Tx) => tx.semiDesign,
  semiDesignTemplate: (tx: Tx) => tx.semiDesignTemplate,
  designFont: (tx: Tx) => tx.designFont,
  seoPage: (tx: Tx) => tx.seoPage,
  articleCategory: (tx: Tx) => tx.articleCategory,
  article: (tx: Tx) => tx.article,
  faqCategory: (tx: Tx) => tx.faqCategory,
  geoProvince: (tx: Tx) => tx.geoProvince,
  geoDistrict: (tx: Tx) => tx.geoDistrict,
  fileObject: (tx: Tx) => tx.fileObject,
} as const;

export type RefModel = keyof typeof MODELS;

interface IdLookup {
  findFirst(args: { where: { publicId: string }; select: { id: true } }): Promise<{ id: bigint } | null>;
}

/**
 * Resolves public ids in a payload to internal ids inside the caller's transaction. An unknown id is
 * a 422 on the field that carried it (contract §3: ids are uuids; internal ids never leave the API).
 */
export class RefResolver {
  constructor(private readonly tx: Tx) {}

  async id(model: RefModel, publicId: string, path: string): Promise<bigint> {
    const delegate = MODELS[model](this.tx) as unknown as IdLookup;
    const row = await delegate.findFirst({ where: { publicId }, select: { id: true } });
    if (!row) {
      throw new DomainException('validation.failed', {
        errors: [{ path, code: 'exists', message: `${path} does not exist` }],
      });
    }
    return row.id;
  }

  /** `undefined` → leave unchanged, `null` → clear, uuid → resolve. */
  async optional(model: RefModel, publicId: string | null | undefined, path: string) {
    if (publicId === undefined) return undefined;
    if (publicId === null) return null;
    return this.id(model, publicId, path);
  }

  /**
   * A catalogue row may reference an uploaded file that is not infected; it is only served once the
   * scan says `clean` (B1.3 files), so a pending scan never blocks editing.
   */
  async file(publicId: string, path: string): Promise<bigint> {
    const file = await this.tx.fileObject.findFirst({
      where: { publicId },
      select: { id: true, uploadStatus: true, scanStatus: true },
    });
    if (!file || file.uploadStatus !== 'uploaded' || file.scanStatus === 'infected') {
      throw new DomainException('validation.failed', {
        errors: [{ path, code: 'fileReady', message: `${path} is not an uploaded file` }],
      });
    }
    return file.id;
  }

  async optionalFile(publicId: string | null | undefined, path: string) {
    if (publicId === undefined) return undefined;
    if (publicId === null) return null;
    return this.file(publicId, path);
  }
}
