import { type Type } from '@nestjs/common';

import {
  AdminDocumentBrandingController,
  AdminMySignaturesController,
  PartnerDocumentBrandingController,
  PartnerMySignaturesController,
} from './branding/document-branding.controllers';

export const DOCUMENTS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminDocumentBrandingController,
  AdminMySignaturesController,
];
export const DOCUMENTS_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerDocumentBrandingController,
  PartnerMySignaturesController,
];
