import { Global, Module } from '@nestjs/common';

import { ErpPrismaService } from './erp-prisma.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, ErpPrismaService],
  exports: [PrismaService, ErpPrismaService],
})
export class DatabaseModule {}
