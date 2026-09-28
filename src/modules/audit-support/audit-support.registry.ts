import { type Type } from '@nestjs/common';

import { AdminAuditSupportController } from './audit-support.controller';

export const AUDIT_SUPPORT_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminAuditSupportController];
