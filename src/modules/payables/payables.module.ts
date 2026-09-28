import { Global, Module } from '@nestjs/common';

import { PayablesQueryService } from './payables-query.service';
import { PurchasingService } from './purchasing.service';
import { VendorInvoicesService } from './vendor-invoices.service';

const SERVICES = [PurchasingService, VendorInvoicesService, PayablesQueryService];

/**
 * Payables (B5.3, accounting-design §2, §6, D-022, D-090, D-165): factory POs at release, goods receipts at
 * POD, billing statements and the factory's own tax invoice, vendor bills, deductions and AP open items.
 */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class PayablesModule {}
