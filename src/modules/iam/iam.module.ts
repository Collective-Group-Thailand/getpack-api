import { Global, Module } from '@nestjs/common';

import { PermissionResolver } from './permission-resolver.service';
import { ScopeDirectory } from './scope-directory';

/** Roles, permissions, scopes and SoD (D-140, `accounting-design.md` §8), shared by every module. */
@Global()
@Module({
  providers: [PermissionResolver, ScopeDirectory],
  exports: [PermissionResolver, ScopeDirectory],
})
export class IamModule {}
