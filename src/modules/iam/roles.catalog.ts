import { type PermissionKey, PERMISSIONS } from './permissions.catalog';

/**
 * System roles of D-140 with their initial grants. Grants follow D-140/D-141; where a decision is
 * silent the grant is the narrowest that lets the role work (docs/PROGRESS.md, B1.2). B1.3 generates
 * `docs/rbac.md` from this file; later modules add grants for their own permissions.
 */
export interface RoleDefinition {
  key: string;
  audience: 'staff' | 'partner' | 'customer';
  scopeType: 'platform' | 'factory' | 'company';
  nameTh: string;
  nameEn: string;
  permissions: readonly PermissionKey[];
}

const ALL_STAFF = PERMISSIONS.filter((p) => p.audience === 'staff').map((p) => p.key);

const EVERY_STAFF_MEMBER: PermissionKey[] = [
  'files.upload',
  'files.read',
  'calendars.read',
  'approvals.read',
  'approvals.delegate',
];
const APPROVER: PermissionKey[] = [...EVERY_STAFF_MEMBER, 'approvals.act', 'settings.read'];
/** Full factory cost — Superadmin, C-Level, VP, Finance (+Manager), Partner Manager (D-141). */
const COST_AND_MARGIN: PermissionKey[] = ['factory_cost.read', 'margin.read'];

export const ROLES: readonly RoleDefinition[] = [
  // --- Packio staff (platform scope)
  {
    key: 'superadmin',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ซูเปอร์แอดมิน',
    nameEn: 'Superadmin',
    permissions: ALL_STAFF,
  },
  {
    key: 'c_level',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ผู้บริหารระดับสูง',
    nameEn: 'C-Level',
    permissions: [...APPROVER, ...COST_AND_MARGIN, 'settings.read_sensitive', 'audit_logs.read'],
  },
  {
    key: 'vp',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'รองประธาน',
    nameEn: 'VP',
    permissions: [...APPROVER, ...COST_AND_MARGIN],
  },
  {
    key: 'director',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ผู้อำนวยการ',
    nameEn: 'Director',
    permissions: APPROVER,
  },
  {
    key: 'admin',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ผู้ดูแลระบบ',
    nameEn: 'Admin',
    permissions: [
      ...EVERY_STAFF_MEMBER,
      'settings.read',
      'feature_flags.read',
      'users.read',
      'users.manage',
      'roles.assign',
      'calendars.manage',
      'notification_templates.manage',
      'catalog.read',
      'catalog.manage',
      'catalog.import',
      'cms.manage',
      'seo.manage',
      'geography.manage',
    ],
  },
  {
    key: 'cs',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ฝ่ายบริการลูกค้า',
    nameEn: 'CS',
    permissions: [...EVERY_STAFF_MEMBER, 'margin.read_pct_when_discounting', 'catalog.read'],
  },
  {
    key: 'cs_lead',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'หัวหน้าฝ่ายบริการลูกค้า',
    nameEn: 'CS Lead',
    permissions: [...EVERY_STAFF_MEMBER, 'margin.read_pct_when_discounting', 'catalog.read'],
  },
  // Prepress and Logistics see neither cost nor margin (D-141).
  {
    key: 'prepress',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ฝ่ายเตรียมพิมพ์',
    nameEn: 'Prepress',
    permissions: [...EVERY_STAFF_MEMBER, 'catalog.read'],
  },
  {
    key: 'finance',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ฝ่ายการเงิน',
    nameEn: 'Finance',
    permissions: [...APPROVER, ...COST_AND_MARGIN, 'audit_logs.read'],
  },
  {
    key: 'finance_manager',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ผู้จัดการฝ่ายการเงิน',
    nameEn: 'Finance Manager',
    permissions: [
      ...APPROVER,
      ...COST_AND_MARGIN,
      'settings.read_sensitive',
      'audit_logs.read',
      'audit_logs.export',
    ],
  },
  {
    key: 'logistics',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ฝ่ายขนส่ง',
    nameEn: 'Logistics',
    permissions: EVERY_STAFF_MEMBER,
  },
  {
    key: 'marketing',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ฝ่ายการตลาด',
    nameEn: 'Marketing',
    // CMS and SEO go to Marketing (no SEO role in D-140, schema-design §7 C-6).
    permissions: [...EVERY_STAFF_MEMBER, 'approvals.act', 'catalog.read', 'cms.manage', 'seo.manage'],
  },
  {
    key: 'partner_manager',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ผู้จัดการพันธมิตร',
    nameEn: 'Partner Manager',
    permissions: [...APPROVER, ...COST_AND_MARGIN, 'catalog.read'],
  },
  {
    key: 'auditor',
    audience: 'staff',
    scopeType: 'platform',
    nameTh: 'ผู้ตรวจสอบบัญชี',
    nameEn: 'Auditor (read-only)',
    permissions: [
      'settings.read',
      'approvals.read',
      'audit_logs.read',
      'audit_logs.export',
      'users.read',
      'files.read',
    ],
  },

  // --- Partner factory (factory scope)
  {
    key: 'factory_owner',
    audience: 'partner',
    scopeType: 'factory',
    nameTh: 'เจ้าของโรงงาน',
    nameEn: 'Factory Owner',
    permissions: ['factory_profile.read', 'factory_users.manage'],
  },
  {
    key: 'factory_planner',
    audience: 'partner',
    scopeType: 'factory',
    nameTh: 'ผู้วางแผนการผลิต',
    nameEn: 'Planner',
    permissions: ['factory_profile.read'],
  },
  {
    key: 'factory_operator',
    audience: 'partner',
    scopeType: 'factory',
    nameTh: 'ผู้ปฏิบัติงาน',
    nameEn: 'Operator',
    permissions: ['factory_profile.read'],
  },
  {
    key: 'factory_qc',
    audience: 'partner',
    scopeType: 'factory',
    nameTh: 'ฝ่ายควบคุมคุณภาพ',
    nameEn: 'QC',
    permissions: ['factory_profile.read'],
  },
  {
    key: 'factory_shipping',
    audience: 'partner',
    scopeType: 'factory',
    nameTh: 'ฝ่ายจัดส่ง',
    nameEn: 'Shipping',
    permissions: ['factory_profile.read'],
  },
  {
    key: 'factory_accountant',
    audience: 'partner',
    scopeType: 'factory',
    nameTh: 'ฝ่ายบัญชีโรงงาน',
    nameEn: 'Factory Accountant',
    permissions: ['factory_profile.read'],
  },

  // --- B2B company (company scope)
  {
    key: 'company_admin',
    audience: 'customer',
    scopeType: 'company',
    nameTh: 'ผู้ดูแลบัญชีบริษัท',
    nameEn: 'Company Admin',
    permissions: ['company_profile.read', 'company_members.manage', 'company_documents.read'],
  },
  {
    key: 'company_buyer',
    audience: 'customer',
    scopeType: 'company',
    nameTh: 'ผู้สั่งซื้อ',
    nameEn: 'Buyer',
    permissions: ['company_profile.read'],
  },
  {
    key: 'company_approver',
    audience: 'customer',
    scopeType: 'company',
    nameTh: 'ผู้อนุมัติ',
    nameEn: 'Approver',
    permissions: ['company_profile.read', 'company_orders.approve'],
  },
  {
    key: 'company_accountant',
    audience: 'customer',
    scopeType: 'company',
    nameTh: 'ฝ่ายบัญชีบริษัท',
    nameEn: 'Accountant',
    permissions: ['company_profile.read', 'company_documents.read'],
  },
];
