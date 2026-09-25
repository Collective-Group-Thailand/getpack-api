import { type ErrorCode } from '@common/errors/error-codes';
import { type PageQuery } from '@common/pagination/pagination.dto';
import { type Tx } from '@database/prisma.service';
import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { type Type } from '@nestjs/common';

import { type RefResolver } from './ref-resolver';

/** The subset of a Prisma model delegate the generic CRUD service uses. */
export interface CrudDelegate {
  findMany(args: object): Promise<unknown[]>;
  count(args: object): Promise<number>;
  findFirst(args: object): Promise<unknown>;
  create(args: object): Promise<unknown>;
  update(args: object): Promise<unknown>;
}

/** Columns every editable catalogue row carries (schema-design §1.4). */
export interface CrudRow {
  id: bigint;
  publicId: string;
  rowVersion: number;
}

/**
 * One admin-editable catalogue/CMS resource (B2.1). The generic service and controller factory
 * turn a descriptor into list / get / create / update (+ soft delete for CMS rows, §1.6) with
 * audit (`config`), a domain event and the full contract documentation (§5).
 */
export interface CatalogResource<
  Row extends CrudRow = CrudRow,
  Dto extends object = object,
  Create extends object = object,
  Update extends object = object,
  Query extends PageQuery = PageQuery,
> {
  /** Singular key: audit resource type and event prefix (`catalog.<key>.created`). */
  key: string;
  /** URL segment under the controller prefix, e.g. `materials`. */
  path: string;
  /** Operation-id resource, e.g. `catalogMaterials` → `admin.catalogMaterials.list`. */
  operation: string;
  /** Prefix of the controller (`catalog`, `cms`, `geography`). */
  area: 'catalog' | 'cms' | 'geography';
  /** Human label for summaries: "material", "print type". */
  label: string;
  labelPlural: string;
  implements: string[];
  /** Extra sentence for the list/create descriptions (business rule). */
  note?: string;
  read: PermissionKey;
  manage: PermissionKey;

  delegate: (tx: Tx) => CrudDelegate;
  include?: object;
  /** Always-on filter, e.g. `{ deletedAt: null }` for soft-deleted CMS rows. */
  baseWhere?: object;
  softDelete?: boolean;

  dto: Type<Dto>;
  createDto: Type<Create>;
  updateDto: Type<Update>;
  queryDto: Type<Query>;
  example: Dto;
  createExample: Create;
  updateExample: Partial<Update>;

  toDto: (row: Row, context: never) => Dto;
  /** Loads what `toDto` needs beyond the row (e.g. public ids of polymorphic references). */
  context?: (rows: Row[], db: Tx) => Promise<unknown>;
  /** Prisma `data` for create; FK public ids resolved through `refs` (422 on unknown ids). */
  createData: (input: Create, refs: RefResolver) => Promise<object> | object;
  /** Prisma `data` for update; `current` is the row being updated (e.g. first publication date). */
  updateData: (input: Update, refs: RefResolver, current: Row) => Promise<object> | object;
  /** Filters of the list query (besides `q`); may look ids up (e.g. a polymorphic subject). */
  where?: (query: Query, db: Tx) => object | Promise<object>;
  /** Columns searched by `q` (ILIKE, backed by trigram indexes where the table is large). */
  search: string[];
  /** Allowed `sort` values → Prisma field. The first entry is the default. */
  sort: Record<string, string>;
  /** Code returned on a unique-key conflict (409). */
  conflict: ErrorCode;
}

/** Keeps generic parameters when declaring a descriptor. */
export const defineResource = <
  Row extends CrudRow,
  Dto extends object,
  Create extends object,
  Update extends object,
  Query extends PageQuery,
>(
  resource: CatalogResource<Row, Dto, Create, Update, Query>,
): CatalogResource<Row, Dto, Create, Update, Query> => resource;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a registry of heterogeneous descriptors
export type AnyCatalogResource = CatalogResource<any, any, any, any, any>;
