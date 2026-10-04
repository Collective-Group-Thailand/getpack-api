import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { MockupsService } from './mockups.service';

export class AddMockupDto {
  @ApiProperty({ enum: ['with_print', 'without_print'], enumName: 'MockupKind', example: 'with_print' })
  @IsIn(['with_print', 'without_print'])
  mockupOption!: 'with_print' | 'without_print';

  @ApiProperty({ example: '800.00', description: 'CS-quoted price, net of VAT (THB)' })
  @IsString()
  @Matches(/^\d{1,9}\.\d{2}$/)
  netAmount!: string;

  @ApiProperty({ example: 'ลูกค้าขอตัวอย่างจริงก่อนผลิต 1 ชิ้น', minLength: 3, maxLength: 800 })
  @IsString()
  @MinLength(3)
  @MaxLength(800)
  reason!: string;
}

export class AddOnChargeDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000e4001',
    description: 'The instalment to pay (due now)',
  })
  instalmentId!: string;

  @ApiProperty({ example: '800.00' })
  netAmount!: string;

  @ApiProperty({ example: '56.00' })
  vatAmount!: string;

  @ApiProperty({ example: '856.00' })
  grossAmount!: string;

  @ApiProperty({ example: '0.00' })
  whtAmount!: string;

  @ApiProperty({ example: '856.00', description: 'What the customer pays (gross − withholding)' })
  cashAmount!: string;
}

@ApiSurface('admin', 'artwork')
@Controller()
export class AdminMockupsController {
  constructor(private readonly mockups: MockupsService) {}

  @Post('orders/:orderId/mockup')
  @Idempotent()
  @Can('mockups.manage')
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.artwork.addMockup',
    summary: 'Add a paid mockup (physical proof) to an order',
    description:
      'The optional paid add-on the customer asked for (D-072), at a CS-quoted price (no calculator prices it yet; ' +
      'audited): an order line and an instalment due now; production of the mockup starts once it is paid. ' +
      'Before production only; one per order. **Deprecated** (D-254): use `admin.samples.create`, which also keeps ' +
      'the factory’s buy amount; this one creates the same attached sample without it. Removed in U-B5.',
    implements: ['D-072', 'D-020', 'D-254'],
    deprecated: { since: '2026-10-03' },
  })
  @ApiBody({
    type: AddMockupDto,
    examples: {
      default: {
        value: {
          mockupOption: 'with_print',
          netAmount: '800.00',
          reason: 'ลูกค้าขอตัวอย่างจริงก่อนผลิต 1 ชิ้น',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Added',
    type: AddOnChargeDto,
    example: {
      instalmentId: '0192f3a0-7c1e-7d2a-9b1f-0000000e4001',
      netAmount: '800.00',
      vatAmount: '56.00',
      grossAmount: '856.00',
      whtAmount: '0.00',
      cashAmount: '856.00',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'mockups.exists',
    'order.invalid_transition',
  )
  async add(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: AddMockupDto,
  ): Promise<AddOnChargeDto> {
    if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
    const c = await this.mockups.add(actor, orderId, body);
    return {
      instalmentId: c.instalmentPublicId,
      netAmount: c.net,
      vatAmount: c.vat,
      grossAmount: c.gross,
      whtAmount: c.wht,
      cashAmount: c.cash,
    };
  }
}
