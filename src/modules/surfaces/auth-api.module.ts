import { CustomerAuthController } from '@modules/auth/controllers/customer-auth.controller';
import { PartnerAuthController } from '@modules/auth/controllers/partner-auth.controller';
import { StaffAuthController } from '@modules/auth/controllers/staff-auth.controller';
import { TokensController } from '@modules/auth/controllers/tokens.controller';
import { Module } from '@nestjs/common';

/** `/v1/auth/*` — each deliverable adds the controllers it owns. */
@Module({
  controllers: [StaffAuthController, PartnerAuthController, CustomerAuthController, TokensController],
})
export class AuthApiModule {}
