import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { VendorInvoiceDto, VI_EXAMPLE } from '@modules/payables/payables.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

import { ErpGetpackBillingService } from './erp-getpack-billing.service';
import { ErpWorkspace } from './erp-workspace.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ErpIssueGetpackInvoiceDto {
  @ApiPropertyOptional({ format: 'date', example: '2026-10-23', description: 'The tax point; default today' })
  @IsOptional()
  @Matches(DAY)
  issueDate?: string;
}

export class ErpHandOverInvoiceDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000f1001',
    description: 'An issued ERP invoice to getpack',
  })
  @IsUUID()
  invoiceId!: string;
}

const WRITE = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
  'payables.erp_invoice_not_allowed',
  'payables.invoice_duplicate',
] as const;

@ApiSurface('partner', 'erpSalesInvoices')
@Controller('factories/:factoryId/erp/getpack-billing/:statementId')
export class PartnerErpGetpackBillingController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly billing: ErpGetpackBillingService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Post('issue')
  @Can('factory_payables.manage', 'factory_receivables.manage')
  @Idempotent()
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpSalesInvoices.issueToGetpack',
    summary: 'Issue my tax invoice to getpack from the ERP for a billing statement',
    description:
      'D-433: for a confirmed statement, the ERP drafts and issues an invoice to getpack under my own number (the ' +
      'statement’s lines; getpack becomes a customer once, from its registered data), renders its PDF and submits it ' +
      'as the statement’s tax invoice (source `erp`). The amounts must equal the statement’s (409 ' +
      '`payables.erp_invoice_not_allowed` says why not). Requires `Idempotency-Key`.',
    implements: ['D-433', 'D-090'],
  })
  @ApiBody({ type: ErpIssueGetpackInvoiceDto, examples: { default: { value: {} } } })
  @ApiSuccess(201, {
    description: 'The submitted tax invoice',
    type: VendorInvoiceDto,
    example: { ...VI_EXAMPLE, source: 'erp' },
  })
  @ApiStandardErrors(...WRITE, 'erp.nothing_to_invoice', 'erp.seller_incomplete')
  async issue(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('statementId', ParseUUIDPipe) statementId: string,
    @Body() body: ErpIssueGetpackInvoiceDto,
  ): Promise<VendorInvoiceDto> {
    const scope = await this.workspace.open(actor, factoryId);
    return this.billing.issueFromStatement(
      scope,
      statementId,
      body,
      await permissionsOf(this.permissions, actor),
    );
  }

  @Post('hand-over')
  @Can('factory_payables.manage', 'factory_receivables.read')
  @Idempotent()
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpSalesInvoices.handOverToGetpack',
    summary: 'Hand an issued ERP invoice to getpack as a statement’s tax invoice',
    description:
      'D-433: an invoice to getpack already issued in my ERP becomes the statement’s tax invoice (source `erp`) with ' +
      'its PDF — no upload. Its amounts must equal the statement’s. Requires `Idempotency-Key`.',
    implements: ['D-433', 'D-090'],
  })
  @ApiBody({
    type: ErpHandOverInvoiceDto,
    examples: { default: { value: { invoiceId: '0192f3a0-7c1e-7d2a-9b1f-0000000f1001' } } },
  })
  @ApiSuccess(201, {
    description: 'The submitted tax invoice',
    type: VendorInvoiceDto,
    example: { ...VI_EXAMPLE, source: 'erp' },
  })
  @ApiStandardErrors(...WRITE)
  async handOver(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('statementId', ParseUUIDPipe) statementId: string,
    @Body() body: ErpHandOverInvoiceDto,
  ): Promise<VendorInvoiceDto> {
    const scope = await this.workspace.open(actor, factoryId);
    return this.billing.handOver(scope, statementId, body.invoiceId);
  }
}
