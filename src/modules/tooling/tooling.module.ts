import { Global, Module } from '@nestjs/common';

import { ToolingService } from './tooling.service';

/** The tooling register and the reorder tooling waiver (U2.7, D-205, D-289). */
@Global()
@Module({ providers: [ToolingService], exports: [ToolingService] })
export class ToolingModule {}
