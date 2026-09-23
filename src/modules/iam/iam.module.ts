import { Global, Module } from '@nestjs/common';

import { PermissionGuard } from './permission.guard';
import { PermissionResolver } from './permission-resolver.service';
import { ScopeDirectory } from './scope-directory';
import { ScopingService } from './scoping.service';
import { SodService } from './sod.service';

/** Roles, permissions, scopes and SoD (D-140, `accounting-design.md` §8), shared by every module. */
@Global()
@Module({
  providers: [PermissionResolver, ScopeDirectory, ScopingService, SodService, PermissionGuard],
  exports: [PermissionResolver, ScopeDirectory, ScopingService, SodService, PermissionGuard],
})
export class IamModule {}
