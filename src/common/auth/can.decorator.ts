import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const REQUIRED_PERMISSIONS = 'getpack:required-permissions';

/**
 * Requires every listed permission (`resource.action`, D-140). Checked by `PermissionGuard` after
 * authentication; a denial is 403 `auth.forbidden` and an audit row. The permissions also appear in
 * the contract as `x-required-permissions` so the frontend can hide what a user cannot do.
 */
export const Can = (...permissions: PermissionKey[]) =>
  applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS, permissions),
    ApiExtension('x-required-permissions', permissions),
  );

export const ANY_PERMISSIONS = 'getpack:any-permissions';

/**
 * Requires at least ONE of the listed permissions (D-469: `sales.pipeline.self` or `sales.pipeline.manage`); the
 * handler then scopes what the caller sees by which one they hold. Checked by `PermissionGuard` like `@Can()`; the
 * contract shows them as `x-required-permissions-any`.
 */
export const CanAny = (...permissions: PermissionKey[]) =>
  applyDecorators(
    SetMetadata(ANY_PERMISSIONS, permissions),
    ApiExtension('x-required-permissions-any', permissions),
  );
