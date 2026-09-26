import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { type CarrierCode } from '@generated/prisma/client';
import { type FallbackCarrierCode } from '@integrations/carriers/carrier-adapter.port';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  ACCOUNT_EXAMPLE,
  AddCarrierAccountDto,
  CARRIER_CODES,
  CARRIER_EXAMPLE,
  CarrierAccountDto,
  CarrierDto,
  CarrierQuoteDto,
  CarrierTestQuoteDto,
  CarrierWebhookAckDto,
  WebhookReceivedDto,
} from './carriers.dto';
import { CarriersService } from './carriers.service';

const DECISIONS = ['D-114', 'D-013', 'D-005'];
const codeParam = ApiParam({ name: 'code', enum: CARRIER_CODES, enumName: 'CarrierCode' });
const codePipe = new ParseEnumPipe(Object.fromEntries(CARRIER_CODES.map((c) => [c, c])));

type AccountRow = Awaited<ReturnType<CarriersService['list']>>[number]['accounts'][number];
const accountDto = (
  a: Omit<AccountRow, 'entity'> & { entity?: { code: string } },
  entityCode?: string,
): CarrierAccountDto => ({
  id: a.publicId,
  label: a.label,
  sandbox: a.sandbox,
  active: a.status === 'active',
  entityCode: a.entity?.code ?? entityCode ?? '',
  createdAt: toBangkokIso(a.createdAt),
});

@ApiSurface('admin', 'carriers')
@Controller('shipping/carriers')
export class AdminCarriersController {
  constructor(private readonly service: CarriersService) {}

  @Get()
  @Can('carriers.read')
  @ApiEndpoint({
    id: 'admin.carriers.list',
    summary: 'List delivery methods and fallback carriers',
    description:
      'The factory fleet (default, D-013) and the Packio-booked fallback carriers with Packio’s accounts; ' +
      'credentials are never returned (D-114, D-005).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Carriers', type: [CarrierDto], example: [CARRIER_EXAMPLE] })
  @ApiStandardErrors()
  async list(): Promise<CarrierDto[]> {
    const rows = await this.service.list();
    return rows.map((c) => ({
      id: c.publicId,
      code: c.code,
      name: c.name,
      enabled: c.enabled,
      supports: c.supports,
      accounts: c.accounts.map((a) => accountDto(a)),
    }));
  }

  @Post(':code/actions/enable')
  @HttpCode(200)
  @Can('carriers.manage')
  @codeParam
  @ApiEndpoint({
    id: 'admin.carriers.enable',
    summary: 'Enable a fallback carrier',
    description:
      'Needs an active Packio account for the carrier. Enabled carriers are asked for estimates where a ' +
      'factory cannot serve a zone (D-114, D-013). Audited, event `carrier.enabled`.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Carrier',
    type: CarrierDto,
    example: { ...CARRIER_EXAMPLE, enabled: true },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'shipping.carrier_fixed',
    'shipping.carrier_account_missing',
  )
  enable(@CurrentActor() actor: Actor, @Param('code', codePipe) code: CarrierCode) {
    return this.toggle(actor, code, true);
  }

  @Post(':code/actions/disable')
  @HttpCode(200)
  @Can('carriers.manage')
  @codeParam
  @ApiEndpoint({
    id: 'admin.carriers.disable',
    summary: 'Disable a fallback carrier',
    description: 'The carrier is no longer asked for estimates or bookings (D-114). Audited.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Carrier', type: CarrierDto, example: CARRIER_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'shipping.carrier_fixed')
  disable(@CurrentActor() actor: Actor, @Param('code', codePipe) code: CarrierCode) {
    return this.toggle(actor, code, false);
  }

  @Post(':code/accounts')
  @Can('carriers.manage')
  @codeParam
  @ApiEndpoint({
    id: 'admin.carriers.addAccount',
    summary: 'Register Packio’s account with a carrier',
    description:
      'Stores the Secrets Manager reference of the credentials (never the credentials, D-005); the ' +
      'previous active account of the same environment is closed. Audited.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AddCarrierAccountDto,
    examples: {
      default: {
        value: {
          label: ACCOUNT_EXAMPLE.label,
          credentialsSecretRef: 'packio/sandbox/carriers/flash-express',
          sandbox: true,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Account', type: CarrierAccountDto, example: ACCOUNT_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.carrier_fixed',
  )
  async addAccount(
    @CurrentActor() actor: Actor,
    @Param('code', codePipe) code: CarrierCode,
    @Body() body: AddCarrierAccountDto,
  ): Promise<CarrierAccountDto> {
    const account = await this.service.addAccount(actor as UserActor, code, body);
    return accountDto(
      account,
      (await this.service.list()).find((c) => c.code === code)?.accounts.find((a) => a.id === account.id)
        ?.entity.code,
    );
  }

  @Post('accounts/:accountId/actions/deactivate')
  @HttpCode(200)
  @Can('carriers.manage')
  @ApiParam({ name: 'accountId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.carriers.deactivateAccount',
    summary: 'Deactivate a carrier account',
    description: 'The account is kept for history and no longer used (D-114). Audited.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Account',
    type: CarrierAccountDto,
    example: { ...ACCOUNT_EXAMPLE, active: false },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async deactivateAccount(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<CarrierAccountDto> {
    const account = await this.service.deactivateAccount(actor as UserActor, accountId);
    const carrier = (await this.service.list()).find((c) => c.accounts.some((a) => a.id === account.id));
    return accountDto(account, carrier?.accounts.find((a) => a.id === account.id)?.entity.code);
  }

  @Post(':code/actions/test-quote')
  @HttpCode(200)
  @Can('carriers.manage')
  @codeParam
  @ApiEndpoint({
    id: 'admin.carriers.testQuote',
    summary: 'Ask a carrier for a quote with Packio’s account',
    description:
      'Checks an account against the carrier (sandbox or production); Deliveree needs coordinates for both ' +
      'places (D-114). Provider errors are returned as problems.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CarrierTestQuoteDto,
    examples: {
      default: {
        value: {
          from: { postcode: '10250' },
          to: { postcode: '50000' },
          parcels: [{ weightG: 3200, lengthCm: 50, widthCm: 48, heightCm: 13 }],
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Quote',
    type: CarrierQuoteDto,
    example: { amount: '85.00', transitDays: 2, currency: 'THB' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.carrier_account_missing',
    'shipping.carrier_refused',
    'provider.unavailable',
  )
  async testQuote(
    @Param('code', codePipe) code: CarrierCode,
    @Body() body: CarrierTestQuoteDto,
  ): Promise<CarrierQuoteDto> {
    const quote = await this.service.testQuote(code, body);
    return { ...quote, currency: 'THB' };
  }

  private async toggle(actor: Actor, code: CarrierCode, enabled: boolean): Promise<CarrierDto> {
    await this.service.setEnabled(actor as UserActor, code, enabled);
    const carrier = (await this.service.list()).find((c) => c.code === code)!;
    return {
      id: carrier.publicId,
      code: carrier.code,
      name: carrier.name,
      enabled: carrier.enabled,
      supports: carrier.supports,
      accounts: carrier.accounts.map((a) => accountDto(a)),
    };
  }
}

/** Carrier callbacks (D-114): verified per carrier, stored once, processed by logistics (B4.3). */
@ApiSurface('webhooks', 'carriers')
@Controller({ path: 'carriers', version: VERSION_NEUTRAL })
export class CarrierWebhooksController {
  constructor(private readonly service: CarriersService) {}

  @Post('flash-express')
  @Public()
  @ApiEndpoint({
    id: 'webhooks.carriers.flashExpress',
    summary: 'Flash Express status callback',
    description:
      'Signed with SHA-256 over `mchId` and `nonceStr` plus Packio’s secret key; stored in the webhook inbox ' +
      '(replays are no-ops) and published as `carrier.webhook_received` (D-114). Answers `{"errorCode":"1"}` ' +
      'when accepted; 401 when the signature is invalid.',
    implements: DECISIONS,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        mchId: { type: 'string' },
        nonceStr: { type: 'string' },
        sign: { type: 'string' },
        data: { type: 'object', properties: { pno: { type: 'string' }, state: { type: 'integer' } } },
      },
    },
    examples: {
      default: {
        value: {
          mchId: 'AA0000',
          nonceStr: '1727340000',
          sign: 'A1B2…',
          data: { pno: 'TH0000000000A', state: 2, stateText: 'In transit' },
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Accepted',
    type: CarrierWebhookAckDto,
    example: { errorCode: '1', state: 'success' },
  })
  @ApiStandardErrors('auth.unauthenticated', 'http.bad_request', 'http.malformed_json', 'validation.failed')
  flash(@Headers() headers: Record<string, string>, @Body() body: unknown, @Res() res: Response) {
    return this.handle('flash_express', headers, body, res);
  }

  @Post('deliveree')
  @Public()
  @ApiEndpoint({
    id: 'webhooks.carriers.deliveree',
    summary: 'Deliveree delivery status callback',
    description:
      'Authenticated by Packio’s webhook key in `Authorization`; stored in the webhook inbox (replays are ' +
      'no-ops) and published as `carrier.webhook_received` (D-114). 200 when accepted, 401 otherwise.',
    implements: DECISIONS,
  })
  @ApiBody({
    schema: { type: 'object', properties: { id: { type: 'integer' }, status: { type: 'string' } } },
    examples: { default: { value: { id: 123456, status: 'delivery_in_progress' } } },
  })
  @ApiSuccess(200, { description: 'Accepted', type: WebhookReceivedDto, example: { received: true } })
  @ApiStandardErrors('auth.unauthenticated', 'http.bad_request', 'http.malformed_json', 'validation.failed')
  deliveree(@Headers() headers: Record<string, string>, @Body() body: unknown, @Res() res: Response) {
    return this.handle('deliveree', headers, body, res);
  }

  /** Invalid signatures are stored (ignored) and answered with the 401 problem. */
  private async handle(
    code: FallbackCarrierCode,
    headers: Record<string, string>,
    body: unknown,
    res: Response,
  ) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const reply = await this.service.webhook(code, lower, body);
    if (reply.status !== 200) throw new DomainException('auth.unauthenticated');
    return res.status(200).json(reply.body);
  }
}
