import { Global, Module } from '@nestjs/common';

import { DocumentBrandingService } from './branding/document-branding.service';
import { DocumentPreviewService } from './branding/document-preview.service';

/**
 * Documents shared by getpack and the factories (D-428 – D-429): logos, company seals and signatures, kept as a
 * history so every document renders with what was in force at its issue.
 */
@Global()
@Module({
  providers: [DocumentBrandingService, DocumentPreviewService],
  exports: [DocumentBrandingService, DocumentPreviewService],
})
export class DocumentsModule {}
