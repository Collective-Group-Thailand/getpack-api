import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiParam } from '@nestjs/swagger';
import { FileSearchResponseDto, PartnerFileSearchQuery } from '@platform/file-search/file-search.dto';
import { FILE_SEARCH_EXAMPLE } from '@platform/file-search/file-search.examples';
import { FileSearchService } from '@platform/file-search/file-search.service';

import { ErpWorkspace } from './erp-workspace.service';

const PARTNER_EXAMPLE: FileSearchResponseDto = {
  ...FILE_SEARCH_EXAMPLE,
  data: FILE_SEARCH_EXAMPLE.data.map((hit) => ({
    ...hit,
    usages: [
      { ...hit.usages[0]!, source: 'erp_doc', code: null, title: 'สัญญาเช่าเครื่องพิมพ์ SM74', version: 2 },
    ],
  })),
};

/**
 * Content search over the factory's own files (D-427): its documents (every version on request), supplier invoices,
 * the PDFs its ERP issued, maintenance photos, getpack job attachments, shipping labels, signed agreements and
 * board data sheets — each only for people holding that area's read permission.
 */
@ApiSurface('partner', 'erpFileSearch')
@Controller('factories/:factoryId/erp/file-search')
export class PartnerErpFileSearchController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly search: FileSearchService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Can('factory_documents.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpFileSearch.search',
    summary: 'Search inside the factory’s documents and files',
    description:
      'Words found in the text read from each file (text layer or OCR, Thai and English; spaces and case ignored, ' +
      'close OCR misreadings allowed) and — when on — by meaning. One hit per file with where it is used (document, ' +
      'invoice, job …) and up to three highlighted passages with their page; exact matches first. A usage shows only ' +
      'with its area’s read permission (`erp_doc` needs `factory_documents.read`, `erp_supplier_invoice` ' +
      '`factory_ap.read`, …) (D-427).',
    implements: ['D-427', 'ADR-0013'],
  })
  @ApiSuccess(200, { description: 'Files found', type: FileSearchResponseDto, example: PARTNER_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async find(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() query: PartnerFileSearchQuery,
  ): Promise<FileSearchResponseDto> {
    const scope = await this.workspace.open(actor, factoryId);
    const permissions = await permissionsOf(this.permissions, actor);
    return this.search.search({ surface: 'partner', permissions, factoryId: scope.factory.id }, query);
  }
}
