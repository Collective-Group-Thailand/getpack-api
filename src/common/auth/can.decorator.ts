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
