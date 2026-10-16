import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, type Type } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { staffOrPartner } from '../partner-actor';
import {
  BANK_IDS,
  BankAccountDto,
  ProposeBankAccountDto,
  RecordVerificationCallDto,
} from './bank-accounts.dto';
import { BankAccountsService } from './bank-accounts.service';

const EXAMPLE: BankAccountDto = {
  id: BANK_IDS.account,
  bankCode: '014',
  branchName: 'สาขาตัวอย่าง',
  accountName: 'บริษัท โรงพิมพ์ตัวอย่าง จำกัด',
  accountNoLast4: '0009',
  status: 'pending_approval',
  effectiveFrom: null,
  approvalRequestId: BANK_IDS.approval,
  verification: null,
  duplicateOfOtherVendor: false,
  createdAt: '2026-09-26T10:00:00+07:00',
};
const DECISIONS = ['D-033', 'D-169', 'D-011'];

/** Bank accounts of a factory for the admin (Partner team, Finance) and partner (own factory) surfaces. */
export function bankAccountsController(
  surface: 'admin' | 'partner',
  permissions: { read: PermissionKey; propose: PermissionKey },
): Type<unknown> {
  const note =
    surface === 'partner'
      ? ' Own factory only; the verification details stay with getpack Finance.'
      : ' Includes the verification call and the duplicate-account flag (§8).';

  @ApiSurface(surface, 'factories')
  @Controller('factories/:factoryId/bank-accounts')
  class BankAccountsController {
    constructor(readonly accounts: BankAccountsService) {}

    @Get()
    @Can(permissions.read)
    @ApiParam({ name: 'factoryId', format: 'uuid' })
    @ApiEndpoint({
      id: `${surface}.factories.listBankAccounts`,
      summary: 'List the payout bank accounts of a factory',
      description: `Newest first; only the last 4 digits of a number are ever returned (PDPA).${note}`,
      implements: DECISIONS,
    })
    @ApiSuccess(200, { description: 'Bank accounts', type: [BankAccountDto], example: [EXAMPLE] })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
      return this.accounts.list(actor, factoryId);
    }

    @Post()
    @Can(permissions.propose)
    @ApiParam({ name: 'factoryId', format: 'uuid' })
    @ApiEndpoint({
      id: `${surface}.factories.proposeBankAccount`,
      summary: 'Propose a new payout bank account',
      description:
        'A change is never an edit: the new account waits for dual approval (Finance → Finance Manager, D-169) and a ' +
        'logged verification call (accounting-design.md §8); it then supersedes the active one. The number is stored ' +
        `encrypted and never returned or logged.${note}`,
      implements: DECISIONS,
    })
    @ApiBody({
      type: ProposeBankAccountDto,
      examples: {
        default: {
          value: {
            bankCode: '014',
            accountName: 'บริษัท โรงพิมพ์ตัวอย่าง จำกัด',
            accountNo: '000-0-00000-9',
          },
        },
      },
    })
    @ApiSuccess(201, { description: 'Proposed', type: BankAccountDto, example: EXAMPLE })
    @ApiStandardErrors(
      'http.bad_request',
      'http.malformed_json',
      'http.not_found',
      'validation.failed',
      'partners.bank_account_pending',
      'approval.already_pending',
    )
    propose(
      @CurrentActor() actor: Actor,
      @Param('factoryId', ParseUUIDPipe) factoryId: string,
      @Body() body: ProposeBankAccountDto,
    ) {
      return this.accounts.propose(staffOrPartner(actor), factoryId, body);
    }
  }
  Object.defineProperty(BankAccountsController, 'name', {
    value: `${surface === 'admin' ? 'Admin' : 'Partner'}BankAccountsController`,
  });
  return BankAccountsController;
}

@ApiSurface('admin', 'vendorBankAccounts')
@Controller('vendor-bank-accounts')
export class VendorBankAccountVerificationController {
  constructor(private readonly accounts: BankAccountsService) {}

  @Post(':accountId/verification-calls')
  @HttpCode(200)
  @Can('vendor_bank_accounts.verify')
  @ApiParam({ name: 'accountId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.vendorBankAccounts.recordVerificationCall',
    summary: 'Record the verification call of a bank-account change',
    description:
      'Finance calls the factory on the number already on record (never one given in the change request) and logs who ' +
      'called, which number (masked), when and the outcome (accounting-design.md §8). A confirmed call activates a change ' +
      'whose approval is complete; approve or reject the change itself through the approvals inbox.',
    implements: ['D-033', 'D-169'],
  })
  @ApiBody({
    type: RecordVerificationCallDto,
    examples: {
      default: {
        value: { outcome: 'confirmed', calledAt: '2026-09-26T11:00:00+07:00', calledNumber: '081-000-1234' },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'The account',
    type: BankAccountDto,
    example: {
      ...EXAMPLE,
      verification: {
        outcome: 'confirmed',
        calledAt: '2026-09-26T11:00:00+07:00',
        calledNumberMasked: '08x-xxx-1234',
      },
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'partners.bank_account_not_pending',
  )
  record(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() body: RecordVerificationCallDto,
  ): Promise<BankAccountDto> {
    return this.accounts.recordVerificationCall(staffOrPartner(actor), accountId, body);
  }
}
