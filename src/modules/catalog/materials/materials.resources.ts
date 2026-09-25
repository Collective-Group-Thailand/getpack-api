import { toBangkokIso } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';

import { type CrudDelegate, defineResource } from '../crud/catalog-resource';
import { compact } from '../crud/compact';
import { num } from '../crud/dto-fields';
import { type RefModel, type RefResolver } from '../crud/ref-resolver';
import {
  AssemblyDto,
  CatalogGroupDto,
  CatalogStatusListQuery,
  CreateAssemblyDto,
  CreateCatalogGroupDto,
  CreateDiecutTypeDto,
  CreateDifficultyLevelDto,
  CreateFinishDto,
  CreateFluteTypeDto,
  CreateFoilTypeDto,
  CreateInkColourDto,
  CreateMaterialDto,
  CreateMaterialFamilyDto,
  CreatePackingTypeDto,
  CreateSpecTitleDto,
  DiecutTypeDto,
  DifficultyLevelDto,
  FinishDto,
  FinishListQuery,
  FluteTypeDto,
  FoilTypeDto,
  GroupedListQuery,
  InkColourDto,
  MATERIAL_IDS,
  MaterialDto,
  MaterialFamilyDto,
  MaterialListQuery,
  PackingTypeDto,
  SpecTitleDto,
  SpecTitleListQuery,
  UpdateAssemblyDto,
  UpdateCatalogGroupDto,
  UpdateDiecutTypeDto,
  UpdateDifficultyLevelDto,
  UpdateFinishDto,
  UpdateFluteTypeDto,
  UpdateFoilTypeDto,
  UpdateInkColourDto,
  UpdateMaterialDto,
  UpdateMaterialFamilyDto,
  UpdatePackingTypeDto,
  UpdateSpecTitleDto,
} from './materials.dto';

const TS = '2026-09-25T10:00:00+07:00';
/** Platform definitions only; factory prices for them are price-list lines (§3.4, D-044). */
const DEFINITIONS = ['D-005', 'D-040'];
const DEFINITION_NOTE =
  'A platform definition without prices: each factory prices it in its own price list (schema-design §3.3, D-044).';

interface Timestamped {
  id: bigint;
  publicId: string;
  rowVersion: number;
  updatedAt: Date;
}
interface Named extends Timestamped {
  code: string;
  nameTh: string;
  nameEn: string;
  status: CatalogStatusValue;
}
type CatalogStatusValue = 'draft' | 'active' | 'inactive' | 'archived';
interface WithGroup {
  group: { publicId: string } | null;
}
const GROUP_INCLUDE = { group: { select: { publicId: true } } } as const;

const status = (q: CatalogStatusListQuery) => compact({ status: q.status });
const grouped = (q: GroupedListQuery) =>
  compact({ status: q.status, group: q.groupId ? { publicId: q.groupId } : undefined });

async function groupId(
  refs: RefResolver,
  model: RefModel,
  value: string | null | undefined,
): Promise<bigint | null | undefined> {
  return refs.optional(model, value, 'groupId');
}

// ------------------------------------------------------------------------------------------------
// Groups: one DTO shape for the five group tables
// ------------------------------------------------------------------------------------------------

interface GroupRow extends Named {
  sort: number;
}

function groupResource(options: {
  key: string;
  path: string;
  operation: string;
  label: string;
  delegate: (tx: Tx) => CrudDelegate;
}) {
  return defineResource({
    ...options,
    area: 'catalog',
    labelPlural: `${options.label}s`,
    implements: DEFINITIONS,
    note: 'Groups organise definitions in the admin zone and the configurator.',
    read: 'catalog.read',
    manage: 'catalog.manage',
    dto: CatalogGroupDto,
    createDto: CreateCatalogGroupDto,
    updateDto: UpdateCatalogGroupDto,
    queryDto: CatalogStatusListQuery,
    example: {
      id: MATERIAL_IDS.group,
      code: 'coating',
      nameTh: 'เคลือบ',
      nameEn: 'Coatings',
      sort: 10,
      status: 'active',
      updatedAt: TS,
    },
    createExample: { code: 'coating', nameTh: 'เคลือบ', nameEn: 'Coatings' },
    updateExample: { sort: 20 },
    toDto: (row: GroupRow): CatalogGroupDto => ({
      id: row.publicId,
      code: row.code,
      nameTh: row.nameTh,
      nameEn: row.nameEn,
      sort: row.sort,
      status: row.status,
      updatedAt: toBangkokIso(row.updatedAt),
    }),
    createData: (input: CreateCatalogGroupDto) => ({ ...input }),
    updateData: (input: UpdateCatalogGroupDto) => compact({ ...input }),
    where: status,
    search: ['code', 'nameTh', 'nameEn'],
    sort: { sort: 'sort', code: 'code', updatedAt: 'updatedAt' },
    conflict: 'catalog.code_taken',
  });
}

export const finishGroups = groupResource({
  key: 'finish_group',
  path: 'finish-groups',
  operation: 'catalogFinishGroups',
  label: 'finish group',
  delegate: (tx) => tx.finishGroup,
});
export const inkColourGroups = groupResource({
  key: 'ink_colour_group',
  path: 'ink-colour-groups',
  operation: 'catalogInkColourGroups',
  label: 'ink colour group',
  delegate: (tx) => tx.inkColourGroup,
});
export const diecutGroups = groupResource({
  key: 'diecut_group',
  path: 'diecut-groups',
  operation: 'catalogDiecutGroups',
  label: 'die-cut group',
  delegate: (tx) => tx.diecutGroup,
});
export const assemblyGroups = groupResource({
  key: 'assembly_group',
  path: 'assembly-groups',
  operation: 'catalogAssemblyGroups',
  label: 'assembly group',
  delegate: (tx) => tx.assemblyGroup,
});
export const difficultyLevelGroups = groupResource({
  key: 'difficulty_level_group',
  path: 'difficulty-level-groups',
  operation: 'catalogDifficultyLevelGroups',
  label: 'difficulty-level group',
  delegate: (tx) => tx.difficultyLevelGroup,
});

// ------------------------------------------------------------------------------------------------

interface FamilyRow extends Named {
  indexUnit: string;
}

export const materialFamilies = defineResource({
  key: 'material_family',
  path: 'material-families',
  operation: 'catalogMaterialFamilies',
  area: 'catalog',
  label: 'material family',
  labelPlural: 'material families',
  implements: ['D-040', 'D-005'],
  note: 'The grouping the material price index follows (D-040 group 1).',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.materialFamily,
  dto: MaterialFamilyDto,
  createDto: CreateMaterialFamilyDto,
  updateDto: UpdateMaterialFamilyDto,
  queryDto: CatalogStatusListQuery,
  example: {
    id: MATERIAL_IDS.family,
    code: 'art_card',
    nameTh: 'กระดาษอาร์ตการ์ด',
    nameEn: 'Art card',
    indexUnit: 'THB/kg',
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'art_card', nameTh: 'กระดาษอาร์ตการ์ด', nameEn: 'Art card', indexUnit: 'THB/kg' },
  updateExample: { indexUnit: 'THB/ton' },
  toDto: (row: FamilyRow): MaterialFamilyDto => ({
    id: row.publicId,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    indexUnit: row.indexUnit,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateMaterialFamilyDto) => ({ ...input }),
  updateData: (input: UpdateMaterialFamilyDto) => compact({ ...input }),
  where: status,
  search: ['code', 'nameTh', 'nameEn'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

type FluteRow = Timestamped & {
  code: string;
  name: string;
  layers: number;
  status: CatalogStatusValue;
} & Record<'colA' | 'colC' | 'colDd' | 'colG' | 'colFh' | 'z', Prisma.Decimal | null>;

export const fluteTypes = defineResource({
  key: 'flute_type',
  path: 'flute-types',
  operation: 'catalogFluteTypes',
  area: 'catalog',
  label: 'flute type',
  labelPlural: 'flute types',
  implements: DEFINITIONS,
  note: 'Take-up factors are indicative until the corrugate calculator is ported (B2.3).',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.fluteType,
  dto: FluteTypeDto,
  createDto: CreateFluteTypeDto,
  updateDto: UpdateFluteTypeDto,
  queryDto: CatalogStatusListQuery,
  example: {
    id: MATERIAL_IDS.flute,
    code: 'BC',
    name: 'ลอน BC (5 ชั้น)',
    layers: 5,
    colA: 1.36,
    colC: 1.46,
    colDd: null,
    colG: null,
    colFh: null,
    z: null,
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'BC', name: 'ลอน BC (5 ชั้น)', layers: 5 },
  updateExample: { colA: 1.36 },
  toDto: (row: FluteRow): FluteTypeDto => ({
    id: row.publicId,
    code: row.code,
    name: row.name,
    layers: row.layers,
    colA: num(row.colA),
    colC: num(row.colC),
    colDd: num(row.colDd),
    colG: num(row.colG),
    colFh: num(row.colFh),
    z: num(row.z),
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateFluteTypeDto) => ({ ...input }),
  updateData: (input: UpdateFluteTypeDto) => compact({ ...input }),
  where: status,
  search: ['code', 'name'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

const MATERIAL_INCLUDE = {
  family: { select: { publicId: true } },
  fluteType: { select: { publicId: true } },
} as const;
interface MaterialRow extends Named {
  kind: MaterialDto['kind'];
  gsm: Prisma.Decimal | null;
  micron: Prisma.Decimal | null;
  paperGroup: string | null;
  insideColour: string | null;
  outsideColour: string | null;
  strength: string | null;
  isFoodGrade: boolean;
  family: { publicId: string } | null;
  fluteType: { publicId: string } | null;
}

export const materialDto = (row: MaterialRow): MaterialDto => ({
  id: row.publicId,
  code: row.code,
  kind: row.kind,
  familyId: row.family?.publicId ?? null,
  nameTh: row.nameTh,
  nameEn: row.nameEn,
  gsm: num(row.gsm),
  micron: num(row.micron),
  fluteTypeId: row.fluteType?.publicId ?? null,
  paperGroup: row.paperGroup,
  insideColour: row.insideColour,
  outsideColour: row.outsideColour,
  strength: row.strength,
  isFoodGrade: row.isFoodGrade,
  status: row.status,
  updatedAt: toBangkokIso(row.updatedAt),
});

export const materials = defineResource({
  key: 'material',
  path: 'materials',
  operation: 'catalogMaterials',
  area: 'catalog',
  label: 'material',
  labelPlural: 'materials',
  implements: DEFINITIONS,
  note: `What the customer picks (paper, board, film, foil…). ${DEFINITION_NOTE} Bulk editing: Excel import kind \`materials\`.`,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.material,
  include: MATERIAL_INCLUDE,
  dto: MaterialDto,
  createDto: CreateMaterialDto,
  updateDto: UpdateMaterialDto,
  queryDto: MaterialListQuery,
  example: {
    id: MATERIAL_IDS.material,
    code: 'art-card-350',
    kind: 'paper',
    familyId: MATERIAL_IDS.family,
    nameTh: 'อาร์ตการ์ด 350 แกรม',
    nameEn: 'Art card 350 gsm',
    gsm: 350,
    micron: null,
    fluteTypeId: null,
    paperGroup: 'art',
    insideColour: 'ขาว',
    outsideColour: 'ขาว',
    strength: null,
    isFoodGrade: false,
    status: 'active',
    updatedAt: TS,
  },
  createExample: {
    code: 'art-card-350',
    kind: 'paper',
    familyId: MATERIAL_IDS.family,
    nameTh: 'อาร์ตการ์ด 350 แกรม',
    nameEn: 'Art card 350 gsm',
    gsm: 350,
  },
  updateExample: { isFoodGrade: true },
  toDto: materialDto,
  createData: async (input: CreateMaterialDto, refs) => ({
    ...input,
    familyId: await refs.optional('materialFamily', input.familyId, 'familyId'),
    fluteTypeId: await refs.optional('fluteType', input.fluteTypeId, 'fluteTypeId'),
  }),
  updateData: async (input: UpdateMaterialDto, refs) =>
    compact({
      ...input,
      familyId: await refs.optional('materialFamily', input.familyId, 'familyId'),
      fluteTypeId: await refs.optional('fluteType', input.fluteTypeId, 'fluteTypeId'),
    }),
  where: (q: MaterialListQuery) =>
    compact({ status: q.status, kind: q.kind, family: q.familyId ? { publicId: q.familyId } : undefined }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { code: 'code', gsm: 'gsm', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

interface FinishRow extends Named, WithGroup {
  finishKind: FinishDto['finishKind'];
  isSpecial: boolean;
  requiresAmount: boolean;
  requiresWidth: boolean;
  requiresLength: boolean;
}

export const finishes = defineResource({
  key: 'finish',
  path: 'finishes',
  operation: 'catalogFinishes',
  area: 'catalog',
  label: 'finish',
  labelPlural: 'finishes',
  implements: [...DEFINITIONS, 'D-076'],
  note: `${DEFINITION_NOTE} \`isSpecial\` (foil, emboss, window) raises the inspection rate (D-076).`,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.finish,
  include: GROUP_INCLUDE,
  dto: FinishDto,
  createDto: CreateFinishDto,
  updateDto: UpdateFinishDto,
  queryDto: FinishListQuery,
  example: {
    id: MATERIAL_IDS.finish,
    groupId: MATERIAL_IDS.group,
    code: 'matt-lamination',
    nameTh: 'เคลือบด้าน',
    nameEn: 'Matt lamination',
    finishKind: 'lamination',
    isSpecial: false,
    requiresAmount: false,
    requiresWidth: false,
    requiresLength: false,
    status: 'active',
    updatedAt: TS,
  },
  createExample: {
    code: 'matt-lamination',
    nameTh: 'เคลือบด้าน',
    nameEn: 'Matt lamination',
    finishKind: 'lamination',
  },
  updateExample: { isSpecial: false },
  toDto: (row: FinishRow): FinishDto => ({
    id: row.publicId,
    groupId: row.group?.publicId ?? null,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    finishKind: row.finishKind,
    isSpecial: row.isSpecial,
    requiresAmount: row.requiresAmount,
    requiresWidth: row.requiresWidth,
    requiresLength: row.requiresLength,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateFinishDto, refs) => ({
    ...input,
    groupId: await groupId(refs, 'finishGroup', input.groupId),
  }),
  updateData: async (input: UpdateFinishDto, refs) =>
    compact({ ...input, groupId: await groupId(refs, 'finishGroup', input.groupId) }),
  where: (q: FinishListQuery) => compact({ ...grouped(q), finishKind: q.finishKind }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

interface FoilRow extends Timestamped {
  code: string;
  name: string;
  status: CatalogStatusValue;
}

export const foilTypes = defineResource({
  key: 'foil_type',
  path: 'foil-types',
  operation: 'catalogFoilTypes',
  area: 'catalog',
  label: 'foil type',
  labelPlural: 'foil types',
  implements: DEFINITIONS,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.foilType,
  dto: FoilTypeDto,
  createDto: CreateFoilTypeDto,
  updateDto: UpdateFoilTypeDto,
  queryDto: CatalogStatusListQuery,
  example: { id: MATERIAL_IDS.foil, code: 'gold', name: 'ฟอยล์ทอง', status: 'active', updatedAt: TS },
  createExample: { code: 'gold', name: 'ฟอยล์ทอง' },
  updateExample: { name: 'ฟอยล์ทองเงา' },
  toDto: (row: FoilRow): FoilTypeDto => ({
    id: row.publicId,
    code: row.code,
    name: row.name,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateFoilTypeDto) => ({ ...input }),
  updateData: (input: UpdateFoilTypeDto) => compact({ ...input }),
  where: status,
  search: ['code', 'name'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

interface InkRow extends Timestamped, WithGroup {
  code: string;
  name: string;
  colourKind: InkColourDto['colourKind'];
  status: CatalogStatusValue;
}

export const inkColours = defineResource({
  key: 'ink_colour',
  path: 'ink-colours',
  operation: 'catalogInkColours',
  area: 'catalog',
  label: 'ink colour',
  labelPlural: 'ink colours',
  implements: DEFINITIONS,
  note: DEFINITION_NOTE,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.inkColour,
  include: GROUP_INCLUDE,
  dto: InkColourDto,
  createDto: CreateInkColourDto,
  updateDto: UpdateInkColourDto,
  queryDto: GroupedListQuery,
  example: {
    id: MATERIAL_IDS.ink,
    groupId: MATERIAL_IDS.group,
    code: 'cmyk-c',
    name: 'Cyan',
    colourKind: 'process',
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'cmyk-c', name: 'Cyan', colourKind: 'process' },
  updateExample: { name: 'Process cyan' },
  toDto: (row: InkRow): InkColourDto => ({
    id: row.publicId,
    groupId: row.group?.publicId ?? null,
    code: row.code,
    name: row.name,
    colourKind: row.colourKind,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateInkColourDto, refs) => ({
    ...input,
    groupId: await groupId(refs, 'inkColourGroup', input.groupId),
  }),
  updateData: async (input: UpdateInkColourDto, refs) =>
    compact({ ...input, groupId: await groupId(refs, 'inkColourGroup', input.groupId) }),
  where: grouped,
  search: ['code', 'name'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

interface DiecutRow extends Named, WithGroup {}

export const diecutTypes = defineResource({
  key: 'diecut_type',
  path: 'diecut-types',
  operation: 'catalogDiecutTypes',
  area: 'catalog',
  label: 'die-cut type',
  labelPlural: 'die-cut types',
  implements: DEFINITIONS,
  note: DEFINITION_NOTE,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.diecutType,
  include: GROUP_INCLUDE,
  dto: DiecutTypeDto,
  createDto: CreateDiecutTypeDto,
  updateDto: UpdateDiecutTypeDto,
  queryDto: GroupedListQuery,
  example: {
    id: MATERIAL_IDS.diecut,
    groupId: MATERIAL_IDS.group,
    code: 'standard-diecut',
    nameTh: 'ไดคัทมาตรฐาน',
    nameEn: 'Standard die-cut',
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'standard-diecut', nameTh: 'ไดคัทมาตรฐาน', nameEn: 'Standard die-cut' },
  updateExample: { nameEn: 'Standard die cut' },
  toDto: (row: DiecutRow): DiecutTypeDto => ({
    id: row.publicId,
    groupId: row.group?.publicId ?? null,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateDiecutTypeDto, refs) => ({
    ...input,
    groupId: await groupId(refs, 'diecutGroup', input.groupId),
  }),
  updateData: async (input: UpdateDiecutTypeDto, refs) =>
    compact({ ...input, groupId: await groupId(refs, 'diecutGroup', input.groupId) }),
  where: grouped,
  search: ['code', 'nameTh', 'nameEn'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

interface AssemblyRow extends Named, WithGroup {
  requiresAmount: boolean;
  requiresWidth: boolean;
  requiresLength: boolean;
  isDoubleItem: boolean;
  skipWaste: boolean;
}

export const assemblies = defineResource({
  key: 'assembly',
  path: 'assemblies',
  operation: 'catalogAssemblies',
  area: 'catalog',
  label: 'assembly',
  labelPlural: 'assemblies',
  implements: DEFINITIONS,
  note: DEFINITION_NOTE,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.assembly,
  include: GROUP_INCLUDE,
  dto: AssemblyDto,
  createDto: CreateAssemblyDto,
  updateDto: UpdateAssemblyDto,
  queryDto: GroupedListQuery,
  example: {
    id: MATERIAL_IDS.assembly,
    groupId: MATERIAL_IDS.group,
    code: 'side-glue',
    nameTh: 'ปะกาวข้าง',
    nameEn: 'Side gluing',
    requiresAmount: false,
    requiresWidth: false,
    requiresLength: false,
    isDoubleItem: false,
    skipWaste: false,
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'side-glue', nameTh: 'ปะกาวข้าง', nameEn: 'Side gluing' },
  updateExample: { requiresAmount: true },
  toDto: (row: AssemblyRow): AssemblyDto => ({
    id: row.publicId,
    groupId: row.group?.publicId ?? null,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    requiresAmount: row.requiresAmount,
    requiresWidth: row.requiresWidth,
    requiresLength: row.requiresLength,
    isDoubleItem: row.isDoubleItem,
    skipWaste: row.skipWaste,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateAssemblyDto, refs) => ({
    ...input,
    groupId: await groupId(refs, 'assemblyGroup', input.groupId),
  }),
  updateData: async (input: UpdateAssemblyDto, refs) =>
    compact({ ...input, groupId: await groupId(refs, 'assemblyGroup', input.groupId) }),
  where: grouped,
  search: ['code', 'nameTh', 'nameEn'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

interface DifficultyRow extends Named, WithGroup {
  sort: number;
}

export const difficultyLevels = defineResource({
  key: 'difficulty_level',
  path: 'difficulty-levels',
  operation: 'catalogDifficultyLevels',
  area: 'catalog',
  label: 'difficulty level',
  labelPlural: 'difficulty levels',
  implements: DEFINITIONS,
  note: `${DEFINITION_NOTE} Plate prices, minimum prices and margins per level are factory or sell-side data.`,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.difficultyLevel,
  include: GROUP_INCLUDE,
  dto: DifficultyLevelDto,
  createDto: CreateDifficultyLevelDto,
  updateDto: UpdateDifficultyLevelDto,
  queryDto: GroupedListQuery,
  example: {
    id: MATERIAL_IDS.difficulty,
    groupId: MATERIAL_IDS.group,
    code: 'level-2',
    nameTh: 'ระดับ 2',
    nameEn: 'Level 2',
    sort: 20,
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'level-2', nameTh: 'ระดับ 2', nameEn: 'Level 2', sort: 20 },
  updateExample: { sort: 30 },
  toDto: (row: DifficultyRow): DifficultyLevelDto => ({
    id: row.publicId,
    groupId: row.group?.publicId ?? null,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateDifficultyLevelDto, refs) => ({
    ...input,
    groupId: await groupId(refs, 'difficultyLevelGroup', input.groupId),
  }),
  updateData: async (input: UpdateDifficultyLevelDto, refs) =>
    compact({ ...input, groupId: await groupId(refs, 'difficultyLevelGroup', input.groupId) }),
  where: grouped,
  search: ['code', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

export const packingTypes = defineResource({
  key: 'packing_type',
  path: 'packing-types',
  operation: 'catalogPackingTypes',
  area: 'catalog',
  label: 'packing type',
  labelPlural: 'packing types',
  implements: DEFINITIONS,
  note: DEFINITION_NOTE,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.packingType,
  dto: PackingTypeDto,
  createDto: CreatePackingTypeDto,
  updateDto: UpdatePackingTypeDto,
  queryDto: CatalogStatusListQuery,
  example: {
    id: MATERIAL_IDS.packing,
    code: 'carton',
    nameTh: 'บรรจุลังกระดาษ',
    nameEn: 'Carton',
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'carton', nameTh: 'บรรจุลังกระดาษ', nameEn: 'Carton' },
  updateExample: { nameEn: 'Shipping carton' },
  toDto: (row: Named): PackingTypeDto => ({
    id: row.publicId,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreatePackingTypeDto) => ({ ...input }),
  updateData: (input: UpdatePackingTypeDto) => compact({ ...input }),
  where: status,
  search: ['code', 'nameTh', 'nameEn'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

interface SpecTitleRow extends Named {
  sort: number;
  productType: { publicId: string } | null;
}

export const specTitles = defineResource({
  key: 'spec_title',
  path: 'spec-titles',
  operation: 'catalogSpecTitles',
  area: 'catalog',
  label: 'spec title',
  labelPlural: 'spec titles',
  implements: DEFINITIONS,
  note: 'Titles of the factory spec lines shown to customers; the values are factory price-list data.',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.specTitle,
  include: { productType: { select: { publicId: true } } },
  dto: SpecTitleDto,
  createDto: CreateSpecTitleDto,
  updateDto: UpdateSpecTitleDto,
  queryDto: SpecTitleListQuery,
  example: {
    id: MATERIAL_IDS.specTitle,
    code: 'paper',
    productTypeId: MATERIAL_IDS.productType,
    nameTh: 'กระดาษ',
    nameEn: 'Paper',
    sort: 10,
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'paper', nameTh: 'กระดาษ', nameEn: 'Paper' },
  updateExample: { sort: 20 },
  toDto: (row: SpecTitleRow): SpecTitleDto => ({
    id: row.publicId,
    code: row.code,
    productTypeId: row.productType?.publicId ?? null,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateSpecTitleDto, refs) => ({
    ...input,
    productTypeId: await refs.optional('productType', input.productTypeId, 'productTypeId'),
  }),
  updateData: async (input: UpdateSpecTitleDto, refs) =>
    compact({
      ...input,
      productTypeId: await refs.optional('productType', input.productTypeId, 'productTypeId'),
    }),
  where: (q: SpecTitleListQuery) =>
    compact({ status: q.status, productType: q.productTypeId ? { publicId: q.productTypeId } : undefined }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});
