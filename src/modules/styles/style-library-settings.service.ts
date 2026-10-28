import { type UserActor } from '@common/context/actor';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';
import { SettingsAdminService } from '@platform/settings/settings-admin.service';

import {
  contentOf,
  EMPTY_STYLE_LIBRARY_CONTENT,
  publicContent,
  STYLE_LIBRARY_SETTING,
  type StyleLibraryContent,
} from './style-library-content';
import {
  type AdminStyleLibrarySettingsDto,
  type StoreStyleLibrarySettingsDto,
  type StyleLibraryContentDto,
} from './style-library-settings.dto';

/**
 * C1c (DECISIONS-STAGE-A §11.5, D-448): the style library page's staff-managed content in the effective-dated, audited
 * setting `storefront.style_library`. Customers read what is in force (expired certificates and logo consent
 * references left out); Admin and Marketing (`styles.curate`, D-246) change it from the back office — a new version
 * through the settings platform (validated against the setting's schema, audited `setting.changed`, evented).
 */
@Injectable()
export class StyleLibrarySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly settingsAdmin: SettingsAdminService,
  ) {}

  async forStore(now = new Date()): Promise<StoreStyleLibrarySettingsDto> {
    return publicContent(await this.content(), bangkokDate(now));
  }

  async forAdmin(): Promise<AdminStyleLibrarySettingsDto> {
    const setting = await this.prisma.setting.findFirst({
      where: { key: STYLE_LIBRARY_SETTING, scopeType: 'platform', scopeId: null },
      select: { publicId: true },
    });
    try {
      const resolved = await this.settings.at(STYLE_LIBRARY_SETTING);
      return {
        content: contentOf(resolved.value),
        versionNo: resolved.versionNo,
        effectiveFrom: toBangkokIso(resolved.effectiveFrom),
        settingId: setting?.publicId ?? null,
      };
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
      return {
        content: EMPTY_STYLE_LIBRARY_CONTENT,
        versionNo: null,
        effectiveFrom: null,
        settingId: setting?.publicId ?? null,
      };
    }
  }

  async update(
    actor: UserActor,
    input: { content: StyleLibraryContentDto; reason: string; effectiveFrom?: string },
  ): Promise<AdminStyleLibrarySettingsDto> {
    await this.settingsAdmin.changeFromEditor(actor, STYLE_LIBRARY_SETTING, {
      value: normalise(input.content),
      reason: input.reason.trim(),
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
    });
    return this.forAdmin();
  }

  private async content(): Promise<StyleLibraryContent> {
    try {
      return contentOf((await this.settings.at(STYLE_LIBRARY_SETTING)).value);
    } catch (error) {
      if (error instanceof SettingNotFoundError) return EMPTY_STYLE_LIBRARY_CONTENT;
      throw error;
    }
  }
}

const text = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const localised = (v: { th: string; en?: string | null }) => ({ th: v.th.trim(), en: text(v.en) });

/** Trimmed, every optional field present as null (the stored shape the setting's schema requires). */
export function normalise(c: StyleLibraryContentDto): StyleLibraryContent {
  return {
    quickSearch: c.quickSearch.map((q) => ({ label: localised(q.label), query: q.query.trim() })),
    materialSwatches: c.materialSwatches.map((m) => ({
      materialClass: m.materialClass,
      colour: text(m.colour),
      imageUrl: text(m.imageUrl),
    })),
    trust: {
      certifications: c.trust.certifications.map((x) => ({
        title: localised(x.title),
        number: text(x.number),
        issuer: text(x.issuer),
        expiresOn: text(x.expiresOn),
        documentUrl: text(x.documentUrl),
      })),
      foodGrade: c.trust.foodGrade.map((x) => ({ title: localised(x.title), documentUrl: text(x.documentUrl) })),
      productionPhotos: c.trust.productionPhotos.map((x) => ({ url: x.url.trim(), alt: localised(x.alt) })),
      customerLogos: c.trust.customerLogos.map((x) => ({
        name: x.name.trim(),
        logoUrl: x.logoUrl.trim(),
        permission: x.permission.trim(),
      })),
      taxInvoiceNote: c.trust.taxInvoiceNote ? localised(c.trust.taxInvoiceNote) : null,
    },
  };
}
