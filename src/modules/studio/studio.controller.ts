import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiAsync, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { quoteDto } from '@modules/quotes/quote-views';
import { QUOTE_EXAMPLE, SavedQuoteDto } from '@modules/quotes/quotes.dto';
import { rfqDto } from '@modules/rfq/rfq-views';
import { RFQ_EXAMPLE } from '@modules/rfq/rfqs.controller';
import { RfqDto } from '@modules/rfq/rfqs.dto';
import { RfqsService } from '@modules/rfq/rfqs.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AcknowledgeCheckDto,
  AddRenderDto,
  CHECK_RUN_EXAMPLE,
  CheckRunDto,
  DesignRenderDto,
  PRINT_JOB_EXAMPLE,
  RULES_EXAMPLE,
  RunChecksDto,
  SaveStudioQuoteDto,
  STUDIO_QUOTE_EXAMPLE,
  StudioApprovalViewDto,
  StudioOrderDto,
  StudioPrintJobDto,
  StudioQuoteDto,
  StudioQuoteRequestDto,
  StudioRfqDto,
  StudioRulesDto,
} from './studio.dto';
import { StudioChecksService } from './studio-checks.service';
import { type JobRow, StudioPrintService } from './studio-print.service';
import { StudioQuotesService } from './studio-quotes.service';

const DECISIONS = ['D-277', 'D-275', 'D-051'];
const designParam = ApiParam({ name: 'designId', format: 'uuid', description: 'My studio design' });
const PRICE_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
  'designs.version_required',
  'studio.spec_missing',
  'studio.spec_mismatch',
  'pricing.vat_rate_missing',
  'specs.unit_not_accepted',
] as const;

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'studio')
@Controller('studio')
export class StoreStudioController {
  constructor(
    private readonly studio: StudioQuotesService,
    private readonly checks: StudioChecksService,
    private readonly print: StudioPrintService,
    private readonly rfqs: RfqsService,
  ) {}

  private async jobView(job: JobRow): Promise<StudioPrintJobDto> {
    return {
      id: job.publicId,
      status: job.status,
      designId: job.version.designDocument.publicId,
      versionNo: job.version.versionNo,
      cartItemId: job.cartItem?.publicId ?? null,
      orderId: job.order?.publicId ?? null,
      submissionId: job.submission?.publicId ?? null,
      ...(await this.print.urls(job)),
      error: job.status === 'failed' ? job.error : null,
      statusUrl: `/v1/store/studio/jobs/${job.publicId}`,
      createdAt: toBangkokIso(job.createdAt),
      completedAt: job.completedAt ? toBangkokIso(job.completedAt) : null,
    };
  }

  @Post(':designId/versions/:versionNo/renders')
  @designParam
  @ApiParam({ name: 'versionNo', type: 'integer' })
  @ApiEndpoint({
    id: 'store.studio.addRender',
    summary: 'Upload the print rendering of a version',
    description:
      'The studio renders a version once (ADR-0011): 300 dpi JPEG tiles of the outside / inside artwork and PNG ' +
      'masks of finish areas, each placed on the sheet in mm. The server assembles the print file from them under the ' +
      'engine’s vector die; it never renders the scene itself (D-280).',
    implements: ['D-280'],
  })
  @ApiBody({
    type: AddRenderDto,
    examples: {
      tile: {
        value: {
          side: 'outside',
          kind: 'tile',
          xMm: 0,
          yMm: 0,
          widthMm: 340.5,
          heightMm: 180,
          fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f701',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'The version’s renders',
    type: [DesignRenderDto],
    example: [
      {
        id: '0192f3a0-7c1e-7d2a-9b1f-00000000f702',
        side: 'outside',
        kind: 'tile',
        separation: null,
        xMm: 0,
        yMm: 0,
        widthMm: 340.5,
        heightMm: 180,
        fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f701',
      },
    ],
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'file.not_ready',
  )
  async addRender(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Param('versionNo', ParseIntPipe) versionNo: number,
    @Body() body: AddRenderDto,
  ): Promise<DesignRenderDto[]> {
    const rows = await this.print.addRender(customer(actor), designId, versionNo, body);
    return rows.map((r) => ({
      id: r.publicId,
      side: r.side,
      kind: r.kind,
      separation: r.separation,
      xMm: r.xMm.toNumber(),
      yMm: r.yMm.toNumber(),
      widthMm: r.widthMm.toNumber(),
      heightMm: r.heightMm.toNumber(),
      fileId: r.file.publicId,
    }));
  }

  @Post(':designId/order')
  @HttpCode(202)
  @Idempotent()
  @designParam
  @ApiEndpoint({
    id: 'store.studio.order',
    summary: 'Order my design version',
    description:
      'One step from the studio (D-280): the version must be checked ready (no block, warnings accepted, D-278), ' +
      'rendered, and priced by its studio quotation (`store.studio.saveQuote`); it goes in the cart pinned to that ' +
      'version — checkout as usual — and its print job starts: the print PDF (vector die on its spot layers, artwork ' +
      'with bleed, a separation page per finish), the 3D snapshot and the digital proof. 202 with the job to poll; ' +
      'once the order is placed the files become its artwork. For a company order needing approval, approvers read ' +
      'it with `store.studio.getApprovalView` (D-281).',
    implements: ['D-280', 'D-278', 'D-276', 'D-281'],
  })
  @ApiBody({
    type: StudioOrderDto,
    examples: {
      default: {
        value: {
          quoteId: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
          quoteOptionId: '0192f3a0-7c1e-7d2a-9b1f-00000000a202',
        },
      },
    },
  })
  @ApiAsync({ poll: 'store.studio.getPrintJob' })
  @ApiSuccess(202, { description: 'Print job queued', type: StudioPrintJobDto, example: PRINT_JOB_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'designs.version_required',
    'studio.quote_not_of_version',
    'studio.checks_not_ready',
    'studio.renders_missing',
    'studio.print_unavailable',
    'cart.item_exists',
  )
  async order(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: StudioOrderDto,
  ): Promise<StudioPrintJobDto> {
    return this.jobView(await this.print.order(customer(actor), designId, body));
  }

  @Get('jobs/:jobId')
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.studio.getPrintJob',
    summary: 'Follow the print job of an ordered version',
    description:
      'Its status and, once done, signed URLs of the print file, the digital proof and the 3D snapshot (D-280).',
    implements: ['D-280'],
  })
  @ApiSuccess(200, { description: 'Print job', type: StudioPrintJobDto, example: PRINT_JOB_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getJob(
    @CurrentActor() actor: Actor,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<StudioPrintJobDto> {
    return this.jobView(await this.print.job(customer(actor), jobId));
  }

  @Get('approvals/:orderId')
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.studio.getApprovalView',
    summary: 'See a studio order waiting for my approval',
    description:
      'For a company approver (`company_orders.approve`) of the order’s company: the ordered version (document and ' +
      'box for the 3D view), the price and the print checks (D-281). A signed-in link, never a token in a message.',
    implements: ['D-281', 'D-123'],
  })
  @ApiSuccess(200, {
    description: 'Approval view',
    type: StudioApprovalViewDto,
    example: {
      orderId: '0192f3a0-7c1e-7d2a-9b1f-00000000a401',
      orderCode: 'PK-2610-0001-01',
      groupStatus: 'pending_company_approval',
      designId: '0192f3a0-7c1e-7d2a-9b1f-00000000d101',
      title: 'กล่องกาแฟ',
      versionNo: 3,
      box: null,
      document: { content: { elements: [] } },
      grossAmount: '13718.40',
      checks: CHECK_RUN_EXAMPLE,
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'auth.forbidden')
  approvalView(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<StudioApprovalViewDto> {
    return this.print.approvalView(customer(actor), orderId);
  }

  @Get('rules')
  @Public()
  @ApiEndpoint({
    id: 'store.studio.getRules',
    summary: 'Print-check rules',
    description:
      'The rule catalogue in force — ids, severities, where each runs, the print methods and material classes it ' +
      'applies to and its thresholds (null: off until Prepress sets it) — so the web checks with exactly the ' +
      'server’s thresholds, and the soft-proof profiles per material class, always labelled “preview, not a ' +
      'contract proof” (D-278, D-279, D-215).',
    implements: ['D-278', 'D-279', 'D-215'],
  })
  @ApiSuccess(200, { description: 'Rules', type: StudioRulesDto, example: RULES_EXAMPLE })
  @ApiStandardErrors()
  getRules(): Promise<StudioRulesDto> {
    return this.checks.rules();
  }

  @Post(':designId/checks')
  @HttpCode(200)
  @designParam
  @ApiEndpoint({
    id: 'store.studio.runChecks',
    summary: 'Check my design version',
    description:
      'Evaluates a version (default: the current one) against the catalogue in force — the rules the server can ' +
      'see in the document: image resolution, text size, hairlines, barcodes, flexo colour count — once per version ' +
      'and catalogue version; the run is stored. `ready` is true with no block and every warning acknowledged (D-278).',
    implements: ['D-278', 'D-283'],
  })
  @ApiBody({ type: RunChecksDto, examples: { default: { value: {} } } })
  @ApiSuccess(200, { description: 'Check run', type: CheckRunDto, example: CHECK_RUN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'designs.version_required',
  )
  runChecks(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: RunChecksDto,
  ): Promise<CheckRunDto> {
    return this.checks.run(customer(actor), designId, body.versionNo);
  }

  @Post(':designId/checks/acknowledgements')
  @HttpCode(200)
  @designParam
  @ApiEndpoint({
    id: 'store.studio.acknowledgeCheck',
    summary: 'Accept a print-check warning',
    description:
      'Records that I accept a warning of the version’s latest check (who, when); blocks must be fixed and are ' +
      'refused (D-278).',
    implements: ['D-278'],
  })
  @ApiBody({
    type: AcknowledgeCheckDto,
    examples: { default: { value: { ruleId: 'image_resolution', elementId: 'el-7' } } },
  })
  @ApiSuccess(200, {
    description: 'Check run',
    type: CheckRunDto,
    example: {
      ...CHECK_RUN_EXAMPLE,
      findings: [{ ...CHECK_RUN_EXAMPLE.findings[0]!, acknowledged: true }],
      ready: true,
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'designs.version_required',
    'studio.checks_not_run',
    'studio.block_not_acknowledgeable',
  )
  acknowledge(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: AcknowledgeCheckDto,
  ): Promise<CheckRunDto> {
    return this.checks.acknowledge(customer(actor), designId, body);
  }

  @Post(':designId/quote')
  @HttpCode(200)
  @designParam
  @ApiEndpoint({
    id: 'store.studio.quote',
    summary: 'Price my studio design',
    description:
      'Prices a version of my design (default: the current one) from its calculator spec — checked against its box: ' +
      'style, sizes and basis, material, print sides — through the same engine and rules as `store.quotes.calculate`, ' +
      'and answers the same calculation object with a `specHash`. The same hash is served from its snapshot for ' +
      '5 minutes. With `previousSpecHash` the answer explains the change (reason codes and unit prices before / now). ' +
      'A type without an instant price answers `mode: rfq` — ask for a quotation instead. Limited to 60 a minute ' +
      '(D-277).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: StudioQuoteRequestDto,
    examples: { default: { value: { quantities: [1000, 3000], deliveryPostcode: '10110' } } },
  })
  @ApiSuccess(200, { description: 'Studio quote', type: StudioQuoteDto, example: STUDIO_QUOTE_EXAMPLE })
  @ApiStandardErrors(...PRICE_ERRORS, 'studio.rate_limited')
  async quote(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: StudioQuoteRequestDto,
  ): Promise<StudioQuoteDto> {
    return this.studio.quote(customer(actor), designId, body);
  }

  @Post(':designId/quote/actions/save')
  @Idempotent()
  @designParam
  @ApiEndpoint({
    id: 'store.studio.saveQuote',
    summary: 'Save the quotation of my studio design',
    description:
      'Saves the quotation of the studio quote — the same input, priced on save like every quotation (D-051) — ' +
      'with the design version and `specHash`; added to the cart with the same design version, checkout charges ' +
      'exactly this quotation (D-277, spec §1).',
    implements: DECISIONS,
  })
  @ApiBody({ type: SaveStudioQuoteDto, examples: { default: { value: { quantities: [1000] } } } })
  @ApiSuccess(201, { description: 'Saved quotation', type: SavedQuoteDto, example: QUOTE_EXAMPLE })
  @ApiStandardErrors(...PRICE_ERRORS, 'pricing.not_instant', 'quotes.nothing_to_save')
  async save(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: SaveStudioQuoteDto,
  ): Promise<SavedQuoteDto> {
    return quoteDto(await this.studio.save(customer(actor), designId, body));
  }

  @Post(':designId/rfq')
  @Idempotent()
  @designParam
  @ApiEndpoint({
    id: 'store.studio.requestQuote',
    summary: 'Ask for a quotation of my studio design',
    description:
      'For a type without an instant price: an RFQ that names the design version, with the sizes, basis and style ' +
      'variant taken from it and the form answers the studio pre-filled (D-277, D-269).',
    implements: [...DECISIONS, 'D-269', 'D-100'],
  })
  @ApiBody({
    type: StudioRfqDto,
    examples: { default: { value: { quantities: [1000], deliveryPostcode: '10110', spec: {} } } },
  })
  @ApiSuccess(201, {
    description: 'Submitted',
    type: RfqDto,
    example: {
      ...RFQ_EXAMPLE,
      status: 'submitted',
      messages: [],
      quotations: [],
      design: { designId: '0192f3a0-7c1e-7d2a-9b1f-00000000d101', versionNo: 3 },
    },
  })
  @ApiStandardErrors(...PRICE_ERRORS, 'numbering.series_missing')
  async requestQuote(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: StudioRfqDto,
  ): Promise<RfqDto> {
    const row = await this.studio.requestQuote(customer(actor), designId, body);
    return rfqDto(row, await this.rfqs.attachments(row));
  }
}
