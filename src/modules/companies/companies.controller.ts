import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { ReasonDto } from '@modules/iam/admin/users-admin.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  AddCompanyKycDocumentDto,
  ADMIN_COMPANY_EXAMPLE,
  AdminCompanyDto,
  APPLY_EXAMPLE,
  ApplyCompanyDto,
  COMPANY_APPROVAL_EXAMPLE,
  COMPANY_EXAMPLE,
  CompanyApprovalDecisionDto,
  CompanyApprovalDto,
  CompanyBranchInputDto,
  CompanyDto,
  CompanyInvitationDto,
  CompanyListQuery,
  INVITATION_EXAMPLE,
  InviteMemberDto,
  ReviewKycDocumentDto,
  UpdateCompanySettingsDto,
} from './companies.dto';
import { CompaniesService, companyEtag, type CompanyRow } from './companies.service';
import { adminCompanyDto, companyDto, invitationDto } from './company-views';

const DECISIONS = ['D-120', 'D-123', 'D-125'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const companyParam = ApiParam({ name: 'companyId', format: 'uuid' });

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

function respond(row: CompanyRow, res: Response): CompanyDto {
  res.setHeader('ETag', companyEtag(row));
  return companyDto(row);
}

@ApiSurface('store', 'companies')
@Controller()
export class StoreCompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post('companies')
  @ApiEndpoint({
    id: 'store.companies.apply',
    summary: 'Apply for a B2B company account',
    description:
      'Creates the company with its head office (branch 00000) and makes me its Company Admin. Next: upload ' +
      'the KYC documents and submit them for review (D-120). New companies are prepaid (D-121).',
    implements: ['D-120', 'D-121'],
  })
  @ApiBody({ type: ApplyCompanyDto, examples: { default: { value: APPLY_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Company',
    type: CompanyDto,
    example: { ...COMPANY_EXAMPLE, status: 'applied', companyCode: null },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'companies.tax_id_taken')
  async apply(
    @CurrentActor() actor: Actor,
    @Body() body: ApplyCompanyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(await this.companies.apply(customer(actor), body), res);
  }

  @Get('companies')
  @ApiEndpoint({
    id: 'store.companies.listMine',
    summary: 'List my companies',
    description: 'Companies I am an active member of (D-125).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Companies', type: [CompanyDto], example: [COMPANY_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async mine(@CurrentActor() actor: Actor): Promise<CompanyDto[]> {
    return (await this.companies.mine(customer(actor).userId)).map(companyDto);
  }

  @Get('companies/:companyId')
  @companyParam
  @ApiEndpoint({
    id: 'store.companies.get',
    summary: 'Get my company',
    description: 'Members only.',
    implements: DECISIONS,
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Company', type: CompanyDto, example: COMPANY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(await this.companies.forMember(customer(actor), id), res);
  }

  @Patch('companies/:companyId')
  @companyParam
  @ApiEndpoint({
    id: 'store.companies.updateSettings',
    summary: 'Update my company’s settings',
    description:
      'Company Admin: PO number policy (D-125), the order value above which the approver must approve ' +
      '(D-123, audited), withholding and document e-mail. Guarded by `If-Match`.',
    implements: DECISIONS,
  })
  @ApiConcurrency()
  @ApiBody({
    type: UpdateCompanySettingsDto,
    examples: { default: { value: { poNumberPolicy: 'required', orderApprovalThreshold: '50000.00' } } },
  })
  @ApiSuccess(200, { description: 'Company', type: CompanyDto, example: COMPANY_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateCompanySettingsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(await this.companies.updateSettings(customer(actor), id, ifMatch, body), res);
  }

  @Post('companies/:companyId/branches')
  @companyParam
  @ApiEndpoint({
    id: 'store.companies.addBranch',
    summary: 'Add a branch',
    description: 'Company Admin; each branch can receive tax invoices (D-125).',
    implements: ['D-125'],
  })
  @ApiBody({
    type: CompanyBranchInputDto,
    examples: {
      default: {
        value: {
          branchCode: '00001',
          name: 'สาขาบางนา',
          line1: '1 ถนนบางนา',
          postcode: '10260',
          provinceId: '0192f3a0-7c1e-7d2a-9b1f-0000000c1006',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Company', type: CompanyDto, example: COMPANY_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'companies.branch_exists')
  async addBranch(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: CompanyBranchInputDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.branchCode)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'branchCode', code: 'required', message: 'required' }],
      });
    return respond(
      await this.companies.addBranch(customer(actor), id, {
        ...body,
        branchType: 'branch',
        branchCode: body.branchCode,
      }),
      res,
    );
  }

  @Delete('companies/:companyId/branches/:branchId')
  @companyParam
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.companies.removeBranch',
    summary: 'Remove a branch',
    description: 'Company Admin; the head office stays.',
    implements: ['D-125'],
  })
  @ApiSuccess(200, { description: 'Company', type: CompanyDto, example: COMPANY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'companies.head_office_required')
  async removeBranch(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(await this.companies.removeBranch(customer(actor), id, branchId), res);
  }

  @Post('companies/:companyId/kyc-documents')
  @companyParam
  @ApiEndpoint({
    id: 'store.companies.addKycDocument',
    summary: 'Add a KYC document',
    description:
      'Company Admin, with a file I uploaded: company certificate (≤ 6 months), ภ.พ.20 if VAT-registered, signatory id (D-120).',
    implements: ['D-120'],
  })
  @ApiBody({
    type: AddCompanyKycDocumentDto,
    examples: {
      default: {
        value: {
          docType: 'company_certificate',
          fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000c1005',
          issuedOn: '2026-09-01',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Company', type: CompanyDto, example: COMPANY_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'companies.invalid_status')
  async addKyc(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: AddCompanyKycDocumentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(await this.companies.addKycDocument(customer(actor), id, body), res);
  }

  @Post('companies/:companyId/actions/submit-kyc')
  @HttpCode(200)
  @companyParam
  @ApiEndpoint({
    id: 'store.companies.submitKyc',
    summary: 'Submit the application for review',
    description: 'Once the required documents are in (D-120).',
    implements: ['D-120'],
  })
  @ApiSuccess(200, {
    description: 'Company',
    type: CompanyDto,
    example: { ...COMPANY_EXAMPLE, status: 'kyc_review', companyCode: null },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'companies.invalid_status',
    'companies.kyc_incomplete',
  )
  async submitKyc(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(await this.companies.submitKyc(customer(actor), id), res);
  }

  @Post('companies/:companyId/members')
  @companyParam
  @ApiEndpoint({
    id: 'store.companies.inviteMember',
    summary: 'Invite a member',
    description:
      'Company Admin: an existing customer account (phone or e-mail) with company roles — Admin, Buyer, Approver, Accountant.',
    implements: ['D-123', 'D-125'],
  })
  @ApiBody({
    type: InviteMemberDto,
    examples: { default: { value: { phone: '+66810001234', roles: ['company_buyer'] } } },
  })
  @ApiSuccess(201, { description: 'Company', type: CompanyDto, example: COMPANY_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'companies.account_not_found', 'companies.already_member')
  async invite(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: InviteMemberDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(await this.companies.invite(customer(actor), id, body), res);
  }

  @Post('companies/:companyId/members/:memberId/actions/remove')
  @HttpCode(200)
  @companyParam
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.companies.removeMember',
    summary: 'Remove a member',
    description: 'Company Admin; the member’s company roles are revoked.',
    implements: ['D-125'],
  })
  @ApiSuccess(200, { description: 'Company', type: CompanyDto, example: COMPANY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'companies.cannot_remove_self')
  async removeMember(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(await this.companies.removeMember(customer(actor), id, memberId), res);
  }

  @Get('company-invitations')
  @ApiEndpoint({
    id: 'store.companies.listInvitations',
    summary: 'List my company invitations',
    description: 'Pending invitations to join a company.',
    implements: ['D-125'],
  })
  @ApiSuccess(200, {
    description: 'Invitations',
    type: [CompanyInvitationDto],
    example: [INVITATION_EXAMPLE],
  })
  @ApiStandardErrors('validation.failed')
  async invitations(@CurrentActor() actor: Actor): Promise<CompanyInvitationDto[]> {
    return (await this.companies.invitations(customer(actor).userId)).map(invitationDto);
  }

  @Post('company-invitations/:memberId/actions/accept')
  @HttpCode(200)
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.companies.acceptInvitation',
    summary: 'Accept a company invitation',
    description: 'I join with the invited company roles.',
    implements: ['D-125'],
  })
  @ApiSuccess(200, { description: 'Company', type: CompanyDto, example: COMPANY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async accept(
    @CurrentActor() actor: Actor,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(await this.companies.accept(customer(actor), memberId), res);
  }
}

@ApiSurface('store', 'companyApprovals')
@Controller('companies/:companyId/approvals')
export class StoreCompanyApprovalsController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @companyParam
  @ApiEndpoint({
    id: 'store.companyApprovals.list',
    summary: 'List orders waiting for my approval',
    description: 'Company approvers: orders above the company threshold, waiting before placement (D-123).',
    implements: ['D-123'],
  })
  @ApiSuccess(200, {
    description: 'Pending approvals',
    type: [CompanyApprovalDto],
    example: [COMPANY_APPROVAL_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
  ): Promise<CompanyApprovalDto[]> {
    const groups = await this.companies.pendingApprovals(customer(actor), id);
    return groups.map((g) => ({
      id: g.companyApprovalRequest!.publicId,
      status: g.companyApprovalRequest!.status,
      groupId: g.publicId,
      groupCode: g.groupCode,
      poNumber: g.poNumber,
      amount: g.grossAmount.toFixed(2),
      requester: {
        id: g.companyApprovalRequest!.requester.publicId,
        displayName: g.companyApprovalRequest!.requester.displayName,
      },
      requestedAt: toBangkokIso(g.companyApprovalRequest!.createdAt),
      currency: 'THB',
    }));
  }

  @Post(':approvalId/actions/:decision')
  @HttpCode(200)
  @companyParam
  @ApiParam({ name: 'approvalId', format: 'uuid' })
  @ApiParam({ name: 'decision', enum: ['approve', 'reject'], enumName: 'CompanyApprovalDecision' })
  @ApiEndpoint({
    id: 'store.companyApprovals.decide',
    summary: 'Approve or reject a company order',
    description:
      'Company approver (not the person who placed it): approved → the order waits for payment and its unpaid ' +
      'expiry starts (D-060); rejected → the order group is cancelled (D-123).',
    implements: ['D-123', 'D-060'],
  })
  @ApiBody({
    type: CompanyApprovalDecisionDto,
    examples: { default: { value: { comment: 'อนุมัติตามงบประมาณ' } } },
  })
  @ApiSuccess(200, {
    description: 'Decision recorded',
    type: CompanyApprovalDto,
    example: { ...COMPANY_APPROVAL_EXAMPLE, status: 'approved' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'approval.not_pending',
    'iam.sod_conflict',
  )
  async decide(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Param('decision') decision: string,
    @Body() body: CompanyApprovalDecisionDto,
  ): Promise<CompanyApprovalDto> {
    if (decision !== 'approve' && decision !== 'reject') throw new DomainException('http.not_found');
    const request = await this.companies.decideApproval(
      customer(actor),
      id,
      approvalId,
      decision === 'approve',
      body.comment ?? null,
    );
    const payload = request.payloadSnapshot as {
      groupId: string;
      groupCode: string;
      poNumber: string | null;
      amount: string;
    };
    return {
      id: request.publicId,
      status: request.status,
      groupId: payload.groupId,
      groupCode: payload.groupCode,
      poNumber: payload.poNumber,
      amount: payload.amount,
      requester: { id: request.requester.publicId, displayName: request.requester.displayName },
      requestedAt: toBangkokIso(request.createdAt),
      currency: 'THB',
    };
  }
}

@ApiSurface('admin', 'companies')
@Controller('companies')
export class AdminCompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @Can('companies.read')
  @ApiEndpoint({
    id: 'admin.companies.list',
    summary: 'List companies',
    description: 'Newest first; `status=kyc_review` is the review queue (D-120).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminCompanyDto, { example: ADMIN_COMPANY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: CompanyListQuery) {
    const where: Prisma.CompanyWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.q && {
        OR: [
          { taxId: q.q },
          { companyCode: { equals: q.q, mode: 'insensitive' as const } },
          { legalName: { contains: q.q, mode: 'insensitive' as const } },
        ],
      }),
    };
    const [rows, total] = await this.companies.list(where, q.page, q.perPage);
    return { data: rows.map(adminCompanyDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get(':companyId')
  @Can('companies.read')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companies.get',
    summary: 'Get a company',
    description: 'With members, branches and KYC documents.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Company', type: AdminCompanyDto, example: ADMIN_COMPANY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('companyId', ParseUUIDPipe) id: string): Promise<AdminCompanyDto> {
    return adminCompanyDto(await this.companies.get(id));
  }

  @Post(':companyId/kyc-documents/:documentId/actions/review')
  @HttpCode(200)
  @Can('companies.kyc_review')
  @companyParam
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.companies.reviewKycDocument',
    summary: 'Verify or reject a KYC document',
    description:
      'A company certificate older than `b2b.kyc_certificate_max_age_months` (6) cannot be verified (D-120).',
    implements: ['D-120'],
  })
  @ApiBody({ type: ReviewKycDocumentDto, examples: { default: { value: { outcome: 'verified' } } } })
  @ApiSuccess(200, { description: 'Company', type: AdminCompanyDto, example: ADMIN_COMPANY_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'companies.certificate_too_old')
  async review(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: ReviewKycDocumentDto,
  ): Promise<AdminCompanyDto> {
    return adminCompanyDto(
      await this.companies.reviewKycDocument(staff(actor), id, documentId, body.outcome, body.note ?? null),
    );
  }

  @Post(':companyId/actions/approve-kyc')
  @HttpCode(200)
  @Can('companies.kyc_review')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companies.approveKyc',
    summary: 'Approve the application',
    description:
      'Every required document verified → the company is active and gets its code (series `company`); it starts prepaid (D-121).',
    implements: ['D-120', 'D-121'],
  })
  @ApiSuccess(200, { description: 'Company', type: AdminCompanyDto, example: ADMIN_COMPANY_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'companies.invalid_status',
    'companies.kyc_incomplete',
  )
  async approve(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
  ): Promise<AdminCompanyDto> {
    return adminCompanyDto(await this.companies.decideKyc(staff(actor), id, true, null));
  }

  @Post(':companyId/actions/reject-kyc')
  @HttpCode(200)
  @Can('companies.kyc_review')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companies.rejectKyc',
    summary: 'Send the application back',
    description: 'With a reason; the company may upload again and resubmit (D-120).',
    implements: ['D-120'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'หนังสือรับรองเกิน 6 เดือน' } } } })
  @ApiSuccess(200, {
    description: 'Company',
    type: AdminCompanyDto,
    example: { ...ADMIN_COMPANY_EXAMPLE, status: 'applied' },
  })
  @ApiStandardErrors(...WRITE, 'companies.invalid_status')
  async reject(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ): Promise<AdminCompanyDto> {
    return adminCompanyDto(await this.companies.decideKyc(staff(actor), id, false, body.reason));
  }

  @Post(':companyId/actions/:action')
  @HttpCode(200)
  @Can('companies.manage')
  @companyParam
  @ApiParam({ name: 'action', enum: ['suspend', 'reactivate', 'close'], enumName: 'CompanyAction' })
  @ApiEndpoint({
    id: 'admin.companies.setStatus',
    summary: 'Suspend, reactivate or close a company',
    description: 'With a reason; closing returns it to prepaid.',
    implements: ['D-120'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ลูกค้าขอปิดบัญชี' } } } })
  @ApiSuccess(200, { description: 'Company', type: AdminCompanyDto, example: ADMIN_COMPANY_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'companies.invalid_status')
  async setStatus(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() body: ReasonDto,
  ): Promise<AdminCompanyDto> {
    if (action !== 'suspend' && action !== 'reactivate' && action !== 'close')
      throw new DomainException('http.not_found');
    return adminCompanyDto(await this.companies.setStatus(staff(actor), id, action, body.reason));
  }
}
