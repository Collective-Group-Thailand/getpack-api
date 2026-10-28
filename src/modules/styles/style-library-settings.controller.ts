import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { staffOrPartner } from '@modules/partners/partner-actor';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Header, Put } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';

import {
  AdminStyleLibrarySettingsDto,
  EMPTY_STORE_STYLE_LIBRARY_EXAMPLE,
  StoreStyleLibrarySettingsDto,
  UpdateStyleLibrarySettingsDto,
} from './style-library-settings.dto';
import { StyleLibrarySettingsService } from './style-library-settings.service';

const DECISIONS = ['D-448', 'D-246', 'D-010', 'D-125'];

const ADMIN_EXAMPLE = {
  content: {
    quickSearch: [],
    materialSwatches: [],
    trust: { certifications: [], foodGrade: [], productionPhotos: [], customerLogos: [], taxInvoiceNote: null },
  },
  versionNo: null,
  effectiveFrom: null,
  settingId: null,
};

/** `/v1/store/style-library/settings` — the /styles page's staff-managed content (C1c, D-448). */
@ApiSurface('store', 'styles')
@Controller('style-library/settings')
export class StoreStyleLibrarySettingsController {
  constructor(private readonly content: StyleLibrarySettingsService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiEndpoint({
    id: 'store.styleLibrary.getSettings',
    summary: 'Get the style library page content staff keep',
    description:
      'C1c (owner decision 2026-10-28, DECISIONS-STAGE-A §11.5, D-448): the "ค้นหาบ่อย" terms, material swatches and ' +
      'the trust section (certificates with number, issuer and expiry, food-grade documents, production-process ' +
      'photos, customer logos the customer permitted, the tax-invoice note) from the effective-dated setting ' +
      '`storefront.style_library`; `compareLimit` is D-246’s 3. Empty while unset — every part is hidden; expired ' +
      'certificates are left out. Nothing here is generated; no factory names (D-050).',
    implements: [...DECISIONS, 'D-050'],
  })
  @ApiSuccess(200, {
    description: 'The content in force',
    type: StoreStyleLibrarySettingsDto,
    example: EMPTY_STORE_STYLE_LIBRARY_EXAMPLE,
  })
  @ApiStandardErrors('validation.failed')
  get(): Promise<StoreStyleLibrarySettingsDto> {
    return this.content.forStore();
  }
}

/** `/v1/admin/style-library/settings` — the back-office editor of that content (Admin, Marketing: `styles.curate`). */
@ApiSurface('admin', 'styles')
@Controller('style-library/settings')
export class AdminStyleLibrarySettingsController {
  constructor(private readonly content: StyleLibrarySettingsService) {}

  @Get()
  @Can('styles.read')
  @ApiEndpoint({
    id: 'admin.styleLibrary.getSettings',
    summary: 'Read the style library page content',
    description:
      'C1c (DECISIONS-STAGE-A §11.5, D-448): the content in force of `storefront.style_library` with its version ' +
      '(staff fields included: certificate expiry, logo permission references). Empty while unset.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'The content in force', type: AdminStyleLibrarySettingsDto, example: ADMIN_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  get(): Promise<AdminStyleLibrarySettingsDto> {
    return this.content.forAdmin();
  }

  @Put()
  @Can('styles.curate')
  @ApiEndpoint({
    id: 'admin.styleLibrary.updateSettings',
    summary: 'Change the style library page content',
    description:
      'C1c (DECISIONS-STAGE-A §11.5, D-448; D-246: curation by Admin or Marketing with `styles.curate`): adds a ' +
      'version of `storefront.style_library` from `effectiveFrom` (now by default, never in the past) through the ' +
      'settings platform — validated against the setting’s schema, audited (`setting.changed` with before / after and ' +
      'the reason), evented, caches invalidated. Only real content: certificates, documents, photos and logos the ' +
      'business holds (logos need the customer’s permission, recorded in `permission`).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: UpdateStyleLibrarySettingsDto,
    examples: {
      default: {
        value: {
          content: {
            ...ADMIN_EXAMPLE.content,
            trust: {
              ...ADMIN_EXAMPLE.content.trust,
              taxInvoiceNote: { th: 'ออกใบกำกับภาษีเต็มรูปแบบทุกคำสั่งซื้อ', en: 'A full tax invoice with every order' },
            },
          },
          reason: 'ข้อความใบกำกับภาษีที่ฝ่ายบัญชีอนุมัติ',
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'The content in force after the change', type: AdminStyleLibrarySettingsDto, example: ADMIN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'settings.backdated',
    'settings.pending_exists',
  )
  update(
    @CurrentActor() actor: Actor,
    @Body() body: UpdateStyleLibrarySettingsDto,
  ): Promise<AdminStyleLibrarySettingsDto> {
    return this.content.update(staffOrPartner(actor), body);
  }
}
