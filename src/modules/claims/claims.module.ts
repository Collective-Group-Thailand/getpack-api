import { Global, Module } from '@nestjs/common';

import { ClaimsService } from './claims.service';
import { GuaranteeService } from './guarantee.service';
import { ReorderService } from './reorder.service';

const SERVICES = [ClaimsService, ReorderService, GuaranteeService];

/** Claims with liability rules and resolutions, and reorders (D-080, D-082, D-083, D-153; B4.5). */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class ClaimsModule {}
