import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ReasonDto } from '@common/dto/reason.dto';
import { type ErrorCode } from '@common/errors/error-codes';
import { etagOf } from '@common/etag/etag';
import { IfMatch, UseEtag } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { applyDecorators, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, type Type } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { ErpTaxExportResultDto } from './erp-e4.dto';
import {
  E6_IDS,
  ErpGlAccountChangeDto,
  ErpGlAccountDto,
  ErpGlAccountListQuery,
  ErpGlAsOfQuery,
  ErpGlAssetCategoryDto,
  ErpGlAssetDto,
  ErpGlAssetListQuery,
  ErpGlBalanceSheetDto,
  ErpGlBankAccountDto,
  ErpGlBankLineDto,
  ErpGlBankLineListQuery,
  ErpGlCashFlowDto,
  ErpGlCashPositionDto,
  ErpGlCatchUpDto,
  ErpGlChangeListQuery,
  ErpGlCloseChecklistDto,
  ErpGlCreateAssetDto,
  ErpGlDecisionDto,
  ErpGlDepreciationRunDto,
  ErpGlDetailDto,
  ErpGlDetailQuery,
  ErpGlDisposeAssetDto,
  ErpGlImportResultDto,
  ErpGlImportStatementDto,
  ErpGlJournalDto,
  ErpGlJournalListQuery,
  ErpGlMarkFiledDto,
  ErpGlMatchBankLineDto,
  ErpGlMonthQuery,
  ErpGlPeriodDto,
  ErpGlPeriodListQuery,
  ErpGlPeriodTransitionDto,
  ErpGlPreviewDto,
  ErpGlPreviewRuleDto,
  ErpGlProfitAndLossDto,
  ErpGlProposeAccountChangeDto,
  ErpGlProposeRuleVersionDto,
  ErpGlRangeQuery,
  ErpGlRecurringDto,
  ErpGlReverseJournalDto,
  ErpGlRuleDetailDto,
  ErpGlRuleDto,
  ErpGlRuleVersionDto,
  ErpGlSaveAssetCategoryDto,
  ErpGlSaveBankAccountDto,
  ErpGlSaveJournalDto,
  ErpGlSaveRecurringDto,
  ErpGlSettingsDto,
  ErpGlStockValuationDto,
  ErpGlTaxFilingDto,
  ErpGlTaxFilingListQuery,
  ErpGlTrialBalanceDto,
  ErpUpdateGlSettingsDto,
} from './erp-e6.dto';
import { ErpLedgerService } from './erp-ledger.service';
import { ErpLedgerAssetsService } from './erp-ledger-assets.service';
import { ErpLedgerJournalsService } from './erp-ledger-journals.service';
import { ErpLedgerPostingService } from './erp-ledger-posting.service';
import { ErpLedgerReportsService } from './erp-ledger-reports.service';
import { ErpLedgerRulesService } from './erp-ledger-rules.service';
import { ErpWorkspace } from './erp-workspace.service';

/**
 * Packio Factory ERP E6 (docs/prompts/E6-factory-general-ledger.md §12, D-385 – D-396): the factory's general
 * ledger under `/v1/partner/factories/{factoryId}/erp/ledger/*`, factory-private (D-317): another factory's id is
 * 404 and no staff endpoint reads `erp_gl_*`.
 */

const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const READ = ['http.not_found', 'validation.failed'] as const;
const byVersion = (b: { id: string; version: number }) => etagOf(b.id, b.version);
const ACTION = (key: string, irreversible = false) => ({ key, irreversible, disabledReason: null });
const perms = (resolver: PermissionResolver, actor: Actor) => permissionsOf(resolver, actor);

function Op(o: {
  id: string;
  summary: string;
  description: string;
  implements: string[];
  can: PermissionKey;
  params?: string[];
  success?: { status: 200 | 201 | 204; description: string; type?: Type<unknown> | [Type<unknown>]; example?: unknown };
  paginated?: { type: Type<unknown>; example: unknown };
  body?: { type: Type<unknown>; example: unknown };
  errors?: readonly ErrorCode[];
  idempotent?: boolean;
  etag?: boolean;
  concurrency?: boolean;
  status?: 200 | 204;
}) {
  return applyDecorators(
    ...(o.status ? [HttpCode(o.status)] : []),
    ...(o.idempotent ? [Idempotent()] : []),
    Can(o.can),
    factoryParam,
    ...(o.params ?? []).map((name) => ApiParam({ name, format: 'uuid' })),
    ...(o.concurrency ? [ApiConcurrency()] : []),
    ...(o.etag ? [UseEtag(byVersion)] : []),
    ApiEndpoint({ id: o.id, summary: o.summary, description: o.description, implements: o.implements }),
    ...(o.body ? [ApiBody({ type: o.body.type, examples: { default: { value: o.body.example } } })] : []),
    ...(o.paginated ? [ApiPaginated(o.paginated.type, { example: o.paginated.example })] : []),
    ...(o.success ? [ApiSuccess(o.success.status, o.success)] : []),
    ApiStandardErrors(...((o.errors ?? ['http.not_found']) as ErrorCode[])),
  );
}

// ------------------------------------------------------------------------------------- examples

const ACC = (code: string, name: string, id: string = E6_IDS.account) => ({ id, code, name });
const SETTINGS: ErpGlSettingsDto = {
  id: E6_IDS.settings,
  fiscalYearStartMonth: 1,
  ledgerStartOn: '2026-10-01',
  itemKindAccounts: { raw_material: '1141', consumable: '1144', spare_part: '1145', semi_finished: '1142', finished_good: '1143', packing: '1146' },
  methodAccounts: { payables: '2111', receivables: '1131', grir: '2115', cash: '1110', bank: '1120' },
  cpaName: 'สำนักงานบัญชี ทดสอบ',
  cpaContact: 'cpa@example.invalid',
  chartTemplateVersion: 1,
  rulesTemplateVersion: 1,
  accounts: 84,
  rules: 20,
  nextActions: [ACTION('erp_ledger.configure'), ACTION('erp_ledger.catch_up')],
  version: 1,
};
const ACCOUNT: ErpGlAccountDto = {
  id: E6_IDS.account,
  code: '1141',
  nameTh: 'วัตถุดิบ',
  nameEn: 'Raw materials',
  accountType: 'asset',
  normalSide: 'debit',
  parent: ACC('1100', 'สินทรัพย์หมุนเวียน', E6_IDS.accountParent),
  isControl: false,
  isPostable: true,
  cashFlowClass: 'operating',
  statementLine: 'inventory',
  status: 'active',
  balance: '125000.00',
  changePending: false,
  nextActions: [ACTION('erp_account.propose')],
  version: 1,
};
const CHANGE: ErpGlAccountChangeDto = {
  id: E6_IDS.change,
  kind: 'create',
  account: null,
  proposed: { code: '1147', nameTh: 'หมึกพิมพ์', nameEn: 'Printing ink', accountType: 'asset', parentCode: '1100', cashFlowClass: 'operating', statementLine: 'inventory' },
  reason: 'แยกหมึกพิมพ์ออกจากวัสดุสิ้นเปลือง',
  status: 'proposed',
  decisionNote: null,
  createdBy: 'ฝ่ายบัญชีโรงงาน ทดสอบ',
  createdAt: '2026-10-13T09:00:00+07:00',
  decidedBy: null,
  decidedAt: null,
  nextActions: [ACTION('erp_account_change.approve'), ACTION('erp_account_change.reject')],
};
const CHECKS = [
  { key: 'stock_valuation', blocking: true, ok: true, expected: '845000.00', actual: '845000.00', difference: '0.00', detail: 'สินค้า 6 รายการ · บัญชี 1141, 1143' },
  { key: 'bank', blocking: true, ok: false, expected: null, actual: null, difference: null, detail: 'รอกระทบ 2 รายการ ใน 1 บัญชี' },
];
const PERIOD: ErpGlPeriodDto = {
  id: E6_IDS.period,
  fiscalYear: 'FY2026',
  fiscalYearId: E6_IDS.year,
  periodNo: 10,
  month: '2026-10',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  status: 'open',
  entries: 42,
  statusChangedBy: null,
  statusChangedAt: null,
  closeNote: null,
  closeChecklist: [],
  nextActions: [ACTION('erp_period.soft_close'), ACTION('erp_period.close')],
};
const CHECKLIST: ErpGlCloseChecklistDto = { periodId: E6_IDS.period, month: '2026-10', status: 'open', checks: CHECKS, canClose: false, openProductionOrders: 3 };
const JOURNAL: ErpGlJournalDto = {
  id: E6_IDS.entry,
  entryNo: 'JV-2610-0012',
  entryDate: '2026-10-13',
  documentDate: '2026-10-13',
  month: '2026-10',
  kind: 'auto',
  status: 'posted',
  description: 'รับสินค้า GR-2610-0003 — บริษัท กระดาษ ทดสอบ จำกัด',
  source: { type: 'erp_goods_receipt', id: E6_IDS.document, number: 'GR-2610-0003' },
  ruleKey: 'F01',
  reverses: null,
  reversedBy: null,
  autoReverseOn: null,
  totalDebit: '12500.00',
  totalCredit: '12500.00',
  rejectionReason: null,
  lines: [
    { lineNo: 1, account: ACC('1141', 'วัตถุดิบ'), debit: '12500.00', credit: '0.00', description: null, item: { id: E6_IDS.item, sku: 'PAP-KA-350', name: 'กระดาษคราฟท์ 350 แกรม', kind: 'raw_material', baseUnit: 'sheet' }, partner: { id: E6_IDS.supplier, code: 'S0001', name: 'บริษัท กระดาษ ทดสอบ จำกัด' }, warehouse: null, productionOrder: null, machine: null, bankAccount: null, taxCode: null, taxBaseAmount: null },
    { lineNo: 2, account: ACC('2115', 'สินค้ารับแล้วยังไม่ได้รับใบแจ้งหนี้'), debit: '0.00', credit: '12500.00', description: null, item: null, partner: { id: E6_IDS.supplier, code: 'S0001', name: 'บริษัท กระดาษ ทดสอบ จำกัด' }, warehouse: null, productionOrder: null, machine: null, bankAccount: null, taxCode: null, taxBaseAmount: null },
  ],
  createdBy: 'ระบบ (กฎ F01)',
  createdAt: '2026-10-13T10:00:00+07:00',
  approvedBy: null,
  postedAt: '2026-10-13T10:00:00+07:00',
  nextActions: [ACTION('erp_journal.reverse', true)],
  version: 2,
};
const MANUAL_BODY = {
  documentDate: '2026-10-31',
  description: 'ค่าเช่าโรงงานเดือนตุลาคม',
  lines: [
    { accountCode: '6150', side: 'debit', amount: '15000.00' },
    { accountCode: '2140', side: 'credit', amount: '15000.00' },
  ],
};
const RECURRING: ErpGlRecurringDto = {
  id: E6_IDS.recurring,
  name: 'ค่าเช่าโรงงานรายเดือน',
  description: 'ค่าเช่าโรงงาน {month}',
  dayOfMonth: 28,
  startOn: '2026-10-01',
  endOn: null,
  autoReverse: false,
  lines: [
    { accountCode: '6150', side: 'debit', amount: '15000.00', description: null },
    { accountCode: '2140', side: 'credit', amount: '15000.00', description: null },
  ],
  status: 'active',
  lastRunMonth: null,
  total: '15000.00',
  nextActions: [ACTION('erp_recurring.edit'), ACTION('erp_recurring.run')],
  version: 1,
};
const RULE: ErpGlRuleDto = {
  id: E6_IDS.rule,
  key: 'F01',
  eventType: 'erp_goods_receipt.posted',
  name: 'รับสินค้าเข้าคลัง',
  description: 'Goods receipt: inventory at cost excl. VAT against GR/IR clearing',
  versionNo: 1,
  template: { description: 'รับสินค้า {documentNo}', lines: [] },
  accountCodes: [],
  entries: 12,
  pending: false,
};
const RULE_TEMPLATE_EXAMPLE = {
  description: 'รับสินค้า {documentNo} — {partnerName}',
  lines: [
    { forEach: 'movements', when: null, accountCode: null, accountPath: 'item.inventoryAccount', side: 'debit', amount: 'item.value', description: null, taxCode: null, taxBase: null },
    { forEach: null, when: null, accountCode: null, accountPath: 'accounts.grir', side: 'credit', amount: 'goodsValue', description: null, taxCode: null, taxBase: null },
  ],
};
const RULE_VERSION: ErpGlRuleVersionDto = {
  id: E6_IDS.ruleVersion,
  versionNo: 2,
  status: 'proposed',
  effectiveFrom: '2026-11-01T00:00:00+07:00',
  current: false,
  template: RULE_TEMPLATE_EXAMPLE,
  reason: 'แยกค่าขนส่งขาเข้าไปบัญชีค่าขนส่ง',
  createdBy: 'ฝ่ายบัญชีโรงงาน ทดสอบ',
  createdAt: '2026-10-14T09:00:00+07:00',
  decidedBy: null,
  decidedAt: null,
  nextActions: [ACTION('erp_rule_version.approve'), ACTION('erp_rule_version.reject')],
};
const RULE_DETAIL: ErpGlRuleDetailDto = {
  id: E6_IDS.rule,
  key: 'F01',
  eventType: 'erp_goods_receipt.posted',
  name: 'รับสินค้าเข้าคลัง',
  description: 'Goods receipt: inventory at cost excl. VAT against GR/IR clearing',
  versions: [RULE_VERSION, { ...RULE_VERSION, id: E6_IDS.rule, versionNo: 1, status: 'approved', effectiveFrom: '1970-01-01T07:00:00+07:00', current: true, reason: 'Template v2', createdBy: null, decidedBy: null, decidedAt: '2026-10-01T09:00:00+07:00', nextActions: [] }],
  variables: [
    { path: 'goodsValue', kind: 'amount', label: 'มูลค่าสินค้าไม่รวมค่าใช้จ่ายนำเข้า' },
    { path: 'movements', kind: 'list', label: 'รายการเคลื่อนไหวสต็อก (ทีละบรรทัด)' },
  ],
  purposes: ['grir', 'payables', 'inputVat'],
  nextActions: [],
};
const PREVIEW: ErpGlPreviewDto = {
  sampleNo: 'GR-2610-0003',
  sampleAt: '2026-10-13T10:00:00+07:00',
  description: 'รับสินค้า GR-2610-0003 — บริษัท กระดาษ ทดสอบ จำกัด',
  lines: [
    { accountCode: '1141', accountName: 'วัตถุดิบ', side: 'debit', amount: '12500.00', description: null, taxCode: null },
    { accountCode: '2115', accountName: 'สินค้ารับแล้วรอใบแจ้งหนี้', side: 'credit', amount: '12500.00', description: null, taxCode: null },
  ],
  totalDebit: '12500.00',
  totalCredit: '12500.00',
  balanced: true,
  problems: [],
};
const TB: ErpGlTrialBalanceDto = {
  from: '2026-10-01',
  to: '2026-10-31',
  rows: [
    { account: ACC('1141', 'วัตถุดิบ'), accountType: 'asset', opening: '100000.00', debit: '45000.00', credit: '20000.00', closing: '125000.00' },
    { account: ACC('3100', 'ทุนที่ชำระแล้ว'), accountType: 'equity', opening: '-100000.00', debit: '0.00', credit: '0.00', closing: '-100000.00' },
  ],
  totalDebit: '125000.00',
  totalCredit: '125000.00',
  balanced: true,
};
const DETAIL: ErpGlDetailDto = {
  account: ACC('1141', 'วัตถุดิบ'),
  from: '2026-10-01',
  to: '2026-10-31',
  opening: '100000.00',
  rows: [{ entryId: E6_IDS.entry, entryNo: 'JV-2610-0012', entryDate: '2026-10-13', description: 'รับสินค้า GR-2610-0003', source: JOURNAL.source, debit: '12500.00', credit: '0.00', balance: '112500.00' }],
  closing: '112500.00',
};
const SECTION = (key: string, line: string, amount: string) => ({
  key,
  lines: [{ key: line, accounts: [{ account: ACC('4110', 'รายได้ขาย'), amount, comparative: amount }], amount, comparative: amount }],
  amount,
  comparative: amount,
});
const PL: ErpGlProfitAndLossDto = {
  month: '2026-10',
  yearStart: '2026-01-01',
  sections: [SECTION('revenue', 'revenue', '245000.00')],
  revenue: '245000.00',
  costOfSales: '180000.00',
  grossProfit: '65000.00',
  expenses: '22000.00',
  netProfit: '43000.00',
  netProfitYtd: '96000.00',
};
const BS: ErpGlBalanceSheetDto = {
  asOf: '2026-10-31',
  comparativeAsOf: '2025-12-31',
  sections: [SECTION('assets', 'inventory', '1250000.00')],
  totalAssets: '1250000.00',
  totalLiabilities: '420000.00',
  totalEquity: '830000.00',
  currentYearProfit: '96000.00',
  balanced: true,
};
const CF: ErpGlCashFlowDto = {
  from: '2026-10-01',
  to: '2026-10-31',
  netProfit: '43000.00',
  nonCash: '12000.00',
  sections: [{ key: 'operating', accounts: [{ account: ACC('1131', 'ลูกหนี้การค้า'), amount: '-8000.00', comparative: null }], amount: '35000.00' }],
  netChange: '35000.00',
  openingCash: '150000.00',
  closingCash: '185000.00',
};
const STOCK: ErpGlStockValuationDto = {
  asOf: '2026-10-31',
  rows: [{ kind: 'raw_material', account: ACC('1141', 'วัตถุดิบ'), items: 12, stockValue: '520000.00', ledgerBalance: '520000.00', difference: '0.00' }],
  stockValue: '520000.00',
  ledgerBalance: '520000.00',
  difference: '0.00',
};
const CATEGORY: ErpGlAssetCategoryDto = {
  id: E6_IDS.category,
  name: 'เครื่องจักร',
  usefulLifeMonths: 60,
  assetAccount: ACC('1230', 'เครื่องจักร'),
  accumulatedAccount: ACC('1239', 'ค่าเสื่อมราคาสะสม - เครื่องจักร'),
  expenseAccount: ACC('5240', 'ค่าเสื่อมราคาเครื่องจักร'),
  gainLossAccount: ACC('4920', 'กำไร (ขาดทุน) จากการขายทรัพย์สิน'),
  status: 'active',
  assets: 3,
};
const ASSET: ErpGlAssetDto = {
  id: E6_IDS.asset,
  assetNo: 'FA-2601-0001',
  name: 'เครื่องพิมพ์ออฟเซ็ท 4 สี',
  category: { id: E6_IDS.category, name: 'เครื่องจักร' },
  machine: { id: E6_IDS.machine, name: 'เครื่องพิมพ์ออฟเซ็ท 4 สี (ทดสอบ)' },
  acquiredOn: '2026-01-15',
  cost: '2400000.00',
  salvageValue: '0.00',
  usefulLifeMonths: 60,
  depreciationStart: '2026-02-01',
  monthlyDepreciation: '40000.00',
  accumulated: '320000.00',
  netBookValue: '2080000.00',
  monthsDepreciated: 8,
  status: 'active',
  disposedOn: null,
  proceeds: null,
  note: null,
  nextActions: [ACTION('erp_asset.dispose', true)],
  version: 1,
};
const RUN: ErpGlDepreciationRunDto = {
  id: E6_IDS.run,
  month: '2026-10',
  periodId: E6_IDS.period,
  entry: { type: 'erp_gl_journal_entry', id: E6_IDS.entry, number: 'JV-2610-0040' },
  total: '40000.00',
  lines: [{ asset: { id: E6_IDS.asset, name: 'FA-2601-0001 · เครื่องพิมพ์ออฟเซ็ท 4 สี' }, months: 1, amount: '40000.00', accumulatedAfter: '360000.00' }],
  createdBy: 'ฝ่ายบัญชีโรงงาน ทดสอบ',
  createdAt: '2026-10-31T17:00:00+07:00',
};
const BANK: ErpGlBankAccountDto = {
  id: E6_IDS.bankAccount,
  name: 'ออมทรัพย์',
  bankName: 'KBANK',
  accountNoLast4: '4321',
  glAccount: ACC('1121', 'KBANK ออมทรัพย์ xx4321'),
  isDefault: true,
  status: 'active',
  ledgerBalance: '185000.00',
  openLines: 2,
  lastStatementDate: '2026-10-12',
  nextActions: [ACTION('erp_bank.edit'), ACTION('erp_bank.import')],
  version: 1,
};
const MATCH = { targetType: 'supplier_payment', targetId: E6_IDS.payment, targetNo: 'PV-2610-0004', entry: null, amount: '12500.00', auto: true, matchedBy: null, matchedAt: '2026-10-13T10:00:00+07:00' };
const LINE: ErpGlBankLineDto = {
  id: E6_IDS.bankLine,
  bankAccount: { id: E6_IDS.bankAccount, name: 'ออมทรัพย์' },
  txnDate: '2026-10-12',
  amount: '-12500.00',
  description: 'โอนเงิน บจก.กระดาษ ทดสอบ',
  reference: 'TRF2026101200123',
  status: 'matched',
  ignoreReason: null,
  matches: [MATCH],
  candidates: [],
  importedAt: '2026-10-13T09:30:00+07:00',
  nextActions: [ACTION('erp_bank_line.unmatch')],
};
const FILING: ErpGlTaxFilingDto = {
  form: 'pp30',
  month: '2026-09',
  dueOn: '2026-10-15',
  ledgerAmount: '12250.00',
  documentsAmount: '12250.00',
  reconciled: true,
  filed: false,
  filedOn: null,
  reference: null,
  filedAmount: null,
  note: null,
  nextActions: [ACTION('erp_tax.mark_filed')],
};

// ============================================================================================ ledger

@ApiSurface('partner', 'erpLedger')
@Controller('factories/:factoryId/erp/ledger')
export class PartnerErpLedgerController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly ledger: ErpLedgerService,
    private readonly posting: ErpLedgerPostingService,
    private readonly rulesEditor: ErpLedgerRulesService,
    private readonly reports: ErpLedgerReportsService,
    private readonly assets: ErpLedgerAssetsService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('settings')
  @Op({
    id: 'partner.erpLedger.getSettings',
    summary: 'Ledger settings',
    description: 'The first read starts the book: the chart of accounts and the posting rules are created from the templates (D-385, D-387).',
    implements: ['D-385', 'D-387'],
    can: 'factory_ledger.read',
    etag: true,
    success: { status: 200, description: 'The settings', type: ErpGlSettingsDto, example: SETTINGS },
  })
  async getSettings(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.ledger.settingsDto(await this.workspace.open(actor, factoryId), await perms(this.permissions, actor));
  }

  @Put('settings')
  @Op({
    id: 'partner.erpLedger.updateSettings',
    summary: 'Change the ledger settings',
    description: 'Fiscal year start (only before the first posting), ledger start date, item-kind and purpose accounts (postable accounts only), the CPA (D-387).',
    implements: ['D-387'],
    can: 'factory_ledger.configure',
    concurrency: true,
    etag: true,
    body: { type: ErpUpdateGlSettingsDto, example: { ledgerStartOn: '2026-10-01', cpaName: 'สำนักงานบัญชี ทดสอบ' } },
    success: { status: 200, description: 'Saved', type: ErpGlSettingsDto, example: SETTINGS },
    errors: WRITE,
  })
  async updateSettings(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @IfMatch() ifMatch: string | undefined, @Body() body: ErpUpdateGlSettingsDto) {
    return this.ledger.updateSettings(await this.workspace.open(actor, factoryId), ifMatch, body, await perms(this.permissions, actor));
  }

  @Get('rules')
  @Op({
    id: 'partner.erpLedger.listRules',
    summary: 'Posting rules',
    description: 'The rules F01 – F18 with the approved version in force and the accounts they post to (D-388).',
    implements: ['D-388'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'Rules', type: [ErpGlRuleDto], example: [RULE] },
  })
  async rules(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.ledger.rulesDto(await this.workspace.open(actor, factoryId));
  }

  @Get('rules/:ruleId')
  @Op({
    id: 'partner.erpLedger.getRule',
    summary: 'A posting rule with its versions',
    description: 'Every version newest first (the one in force flagged), what the document carries for the template and the purpose accounts (D-398).',
    implements: ['D-388', 'D-398'],
    can: 'factory_ledger.read',
    params: ['ruleId'],
    success: { status: 200, description: 'The rule', type: ErpGlRuleDetailDto, example: RULE_DETAIL },
  })
  async getRule(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('ruleId', ParseUUIDPipe) ruleId: string) {
    return this.rulesEditor.getRule(await this.workspace.open(actor, factoryId), ruleId, await perms(this.permissions, actor));
  }

  @Post('rules/:ruleId/actions/preview')
  @Op({
    id: 'partner.erpLedger.previewRule',
    summary: 'Try a template on the latest document',
    description: 'Renders the template against the factory’s latest document of the rule’s kind without posting; lists what is wrong with it (D-398).',
    implements: ['D-398'],
    can: 'factory_ledger.read',
    params: ['ruleId'],
    status: 200,
    body: { type: ErpGlPreviewRuleDto, example: { template: RULE_TEMPLATE_EXAMPLE } },
    success: { status: 200, description: 'The entry it would post', type: ErpGlPreviewDto, example: PREVIEW },
    errors: WRITE,
  })
  async previewRule(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('ruleId', ParseUUIDPipe) ruleId: string, @Body() body: ErpGlPreviewRuleDto) {
    return this.rulesEditor.preview(await this.workspace.open(actor, factoryId), ruleId, body.template);
  }

  @Post('rules/:ruleId/versions')
  @Op({
    id: 'partner.erpLedger.proposeRuleVersion',
    summary: 'Propose a new rule version',
    description: 'Waits for another person’s approval and is in force from its day; refused while another version waits, or when the template has problems or does not balance on the latest document (D-398).',
    implements: ['D-398'],
    can: 'factory_ledger.configure',
    params: ['ruleId'],
    idempotent: true,
    body: { type: ErpGlProposeRuleVersionDto, example: { template: RULE_TEMPLATE_EXAMPLE, effectiveFrom: '2026-11-01', reason: 'แยกค่าขนส่งขาเข้าไปบัญชีค่าขนส่ง' } },
    success: { status: 201, description: 'Proposed', type: ErpGlRuleDetailDto, example: RULE_DETAIL },
    errors: [...WRITE, 'erp.ledger_version_pending'],
  })
  async proposeRuleVersion(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('ruleId', ParseUUIDPipe) ruleId: string, @Body() body: ErpGlProposeRuleVersionDto) {
    return this.rulesEditor.propose(await this.workspace.open(actor, factoryId), ruleId, body, await perms(this.permissions, actor));
  }

  @Post('rules/:ruleId/versions/:versionId/actions/approve')
  @Op({
    id: 'partner.erpLedger.approveRuleVersion',
    summary: 'Approve a rule version',
    description: 'Documents dated from its day post with it; never your own proposal (D-398).',
    implements: ['D-398'],
    can: 'factory_ledger.approve',
    params: ['ruleId', 'versionId'],
    idempotent: true,
    status: 200,
    body: { type: ErpGlDecisionDto, example: { note: 'เห็นชอบ' } },
    success: { status: 200, description: 'Approved', type: ErpGlRuleDetailDto, example: RULE_DETAIL },
    errors: [...WRITE, 'erp.invalid_status', 'erp.ledger_self_approval'],
  })
  async approveRuleVersion(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('ruleId', ParseUUIDPipe) ruleId: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() body: ErpGlDecisionDto) {
    return this.rulesEditor.decide(await this.workspace.open(actor, factoryId), ruleId, versionId, 'approve', body.note ?? null, await perms(this.permissions, actor));
  }

  @Post('rules/:ruleId/versions/:versionId/actions/reject')
  @Op({
    id: 'partner.erpLedger.rejectRuleVersion',
    summary: 'Reject a rule version',
    description: 'The rule keeps the version in force (D-398).',
    implements: ['D-398'],
    can: 'factory_ledger.approve',
    params: ['ruleId', 'versionId'],
    idempotent: true,
    status: 200,
    body: { type: ErpGlDecisionDto, example: { note: 'ใช้บัญชีเดิมต่อไป' } },
    success: { status: 200, description: 'Rejected', type: ErpGlRuleDetailDto, example: RULE_DETAIL },
    errors: [...WRITE, 'erp.invalid_status', 'erp.ledger_self_approval'],
  })
  async rejectRuleVersion(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('ruleId', ParseUUIDPipe) ruleId: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() body: ErpGlDecisionDto) {
    return this.rulesEditor.decide(await this.workspace.open(actor, factoryId), ruleId, versionId, 'reject', body.note ?? null, await perms(this.permissions, actor));
  }

  @Post('rules/:ruleId/versions/:versionId/actions/withdraw')
  @Op({
    id: 'partner.erpLedger.withdrawRuleVersion',
    summary: 'Withdraw your rule version',
    description: 'Only the proposer, while it waits (D-398).',
    implements: ['D-398'],
    can: 'factory_ledger.configure',
    params: ['ruleId', 'versionId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'Withdrawn', type: ErpGlRuleDetailDto, example: RULE_DETAIL },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async withdrawRuleVersion(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('ruleId', ParseUUIDPipe) ruleId: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.rulesEditor.decide(await this.workspace.open(actor, factoryId), ruleId, versionId, 'withdraw', null, await perms(this.permissions, actor));
  }

  @Post('actions/catch-up')
  @Op({
    id: 'partner.erpLedger.catchUp',
    summary: 'Post documents not yet in the books',
    description: 'Replays the ERP’s events since the ledger start that have no entry yet (a ledger started after the ERP); each event is posted on its own (D-388).',
    implements: ['D-388'],
    can: 'factory_ledger.configure',
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'What was posted', type: ErpGlCatchUpDto, example: { posted: 14, skipped: 2, failed: [] } },
  })
  async catchUp(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.posting.catchUp(await this.workspace.open(actor, factoryId));
  }

  @Get('accounts')
  @Op({
    id: 'partner.erpLedger.listAccounts',
    summary: 'Chart of accounts',
    description: 'By code, with today’s balance on each account’s normal side (D-386).',
    implements: ['D-386'],
    can: 'factory_ledger.read',
    paginated: { type: ErpGlAccountDto, example: ACCOUNT },
    errors: READ,
  })
  async accounts(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlAccountListQuery) {
    return this.ledger.listAccounts(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Get('account-changes')
  @Op({
    id: 'partner.erpLedger.listAccountChanges',
    summary: 'Chart changes',
    description: 'Proposed, approved and rejected changes to the chart, newest first (D-386).',
    implements: ['D-386'],
    can: 'factory_ledger.read',
    paginated: { type: ErpGlAccountChangeDto, example: CHANGE },
    errors: READ,
  })
  async changes(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlChangeListQuery) {
    return this.ledger.listChanges(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('account-changes')
  @Op({
    id: 'partner.erpLedger.proposeAccountChange',
    summary: 'Propose a chart change',
    description: 'Create, update, deactivate or reactivate an account; another person with `factory_ledger.approve` decides (maker-checker, D-386).',
    implements: ['D-386'],
    can: 'factory_ledger.configure',
    idempotent: true,
    body: { type: ErpGlProposeAccountChangeDto, example: { kind: 'create', proposed: CHANGE.proposed, reason: CHANGE.reason } },
    success: { status: 201, description: 'Proposed', type: ErpGlAccountChangeDto, example: CHANGE },
    errors: [...WRITE, 'erp.ledger_change_pending'],
  })
  async propose(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGlProposeAccountChangeDto) {
    return this.ledger.proposeChange(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Post('account-changes/:changeId/actions/approve')
  @Op({
    id: 'partner.erpLedger.approveAccountChange',
    summary: 'Approve a chart change',
    description: 'Applies it; never your own proposal (D-386).',
    implements: ['D-386'],
    can: 'factory_ledger.approve',
    params: ['changeId'],
    idempotent: true,
    status: 200,
    body: { type: ErpGlDecisionDto, example: { note: 'เห็นชอบ' } },
    success: { status: 200, description: 'Approved', type: ErpGlAccountChangeDto, example: { ...CHANGE, status: 'approved', nextActions: [] } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.ledger_self_approval'],
  })
  async approveChange(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('changeId', ParseUUIDPipe) changeId: string, @Body() body: ErpGlDecisionDto) {
    return this.ledger.decideChange(await this.workspace.open(actor, factoryId), changeId, true, body.note ?? null, await perms(this.permissions, actor));
  }

  @Post('account-changes/:changeId/actions/reject')
  @Op({
    id: 'partner.erpLedger.rejectAccountChange',
    summary: 'Reject a chart change',
    description: 'The chart stays as it is (D-386).',
    implements: ['D-386'],
    can: 'factory_ledger.approve',
    params: ['changeId'],
    idempotent: true,
    status: 200,
    body: { type: ErpGlDecisionDto, example: { note: 'ใช้บัญชี 1144 ต่อไป' } },
    success: { status: 200, description: 'Rejected', type: ErpGlAccountChangeDto, example: { ...CHANGE, status: 'rejected', nextActions: [] } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.ledger_self_approval'],
  })
  async rejectChange(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('changeId', ParseUUIDPipe) changeId: string, @Body() body: ErpGlDecisionDto) {
    return this.ledger.decideChange(await this.workspace.open(actor, factoryId), changeId, false, body.note ?? null, await perms(this.permissions, actor));
  }

  @Get('periods')
  @Op({
    id: 'partner.erpLedger.listPeriods',
    summary: 'Fiscal periods',
    description: 'The months of the current and the previous fiscal year from the ledger start, with their status (D-390).',
    implements: ['D-390'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'Periods', type: [ErpGlPeriodDto], example: [PERIOD] },
    errors: READ,
  })
  async periods(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlPeriodListQuery) {
    return this.ledger.listPeriods(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Get('periods/:periodId/checklist')
  @Op({
    id: 'partner.erpLedger.closeChecklist',
    summary: 'Close checklist of a period',
    description: 'Stock, payables, receivables, VAT and WHT against their accounts; bank reconciled; depreciation run; open WIP (D-390).',
    implements: ['D-390'],
    can: 'factory_ledger.read',
    params: ['periodId'],
    success: { status: 200, description: 'The checklist', type: ErpGlCloseChecklistDto, example: CHECKLIST },
  })
  async checklist(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('periodId', ParseUUIDPipe) periodId: string) {
    return this.ledger.closeChecklistDto(await this.workspace.open(actor, factoryId), periodId);
  }

  @Post('periods/:periodId/actions/transition')
  @Op({
    id: 'partner.erpLedger.transitionPeriod',
    summary: 'Soft-close, close, lock or reopen a period',
    description:
      'In order: a period closes after the one before it and only when every blocking check passes; a locked period never reopens; ' +
      'reopening needs a reason. Documents dated in a closed period post into the next open one (D-390).',
    implements: ['D-390'],
    can: 'factory_ledger.close',
    params: ['periodId'],
    idempotent: true,
    status: 200,
    body: { type: ErpGlPeriodTransitionDto, example: { action: 'close', note: 'ปิดงวดตุลาคม' } },
    success: { status: 200, description: 'Changed', type: ErpGlPeriodDto, example: { ...PERIOD, status: 'closed', closeChecklist: CHECKS, nextActions: [ACTION('erp_period.lock'), ACTION('erp_period.reopen')] } },
    errors: [...WRITE, 'erp.ledger_period_transition', 'erp.ledger_close_blocked'],
  })
  async transition(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('periodId', ParseUUIDPipe) periodId: string, @Body() body: ErpGlPeriodTransitionDto) {
    return this.ledger.transition(await this.workspace.open(actor, factoryId), periodId, body, await perms(this.permissions, actor));
  }

  @Post('fiscal-years/:yearId/actions/close')
  @Op({
    id: 'partner.erpLedger.closeYear',
    summary: 'Close a fiscal year',
    description: 'When months 1 – 11 are closed and the last month is soft-closed: the year’s profit or loss moves to retained earnings in one closing entry in the last month, which then closes as usual (D-390).',
    implements: ['D-390'],
    can: 'factory_ledger.close',
    params: ['yearId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'The closing entry (none when the year had no profit or loss)', type: [ErpGlJournalDto], example: [{ ...JOURNAL, kind: 'closing', ruleKey: null, source: null, nextActions: [] }] },
    errors: ['http.not_found', 'erp.ledger_close_blocked', 'erp.ledger_already_posted'],
  })
  async closeYear(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('yearId', ParseUUIDPipe) yearId: string) {
    return this.reports.closeYearDto(await this.workspace.open(actor, factoryId), yearId, await perms(this.permissions, actor));
  }

  @Get('tax-filings')
  @Op({
    id: 'partner.erpLedger.listTaxFilings',
    summary: 'VAT and WHT returns',
    description: 'ภ.พ.30, ภ.ง.ด.3 and ภ.ง.ด.53 per month: the ledger against the documents, the due date and whether it was filed (D-392).',
    implements: ['D-392'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'Returns', type: [ErpGlTaxFilingDto], example: [FILING] },
    errors: READ,
  })
  async filings(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlTaxFilingListQuery) {
    return this.assets.filings(await this.workspace.open(actor, factoryId), q.year, await perms(this.permissions, actor));
  }

  @Post('tax-filings')
  @Op({
    id: 'partner.erpLedger.markTaxFiled',
    summary: 'Mark a return filed',
    description: 'The filing date, the Revenue Department reference and the amount filed (default: the ledger’s), D-392.',
    implements: ['D-392'],
    can: 'factory_tax.file',
    idempotent: true,
    body: { type: ErpGlMarkFiledDto, example: { form: 'pp30', month: '2026-09', filedOn: '2026-10-14', reference: 'RD-EF-2610-000123' } },
    success: { status: 201, description: 'The returns of that year', type: [ErpGlTaxFilingDto], example: [{ ...FILING, filed: true, filedOn: '2026-10-14', reference: 'RD-EF-2610-000123', filedAmount: '12250.00', nextActions: [] }] },
    errors: [...WRITE, 'erp.ledger_tax_filed'],
  })
  async markFiled(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGlMarkFiledDto) {
    return this.assets.markFiled(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }
}

// ========================================================================================== journals

@ApiSurface('partner', 'erpJournals')
@Controller('factories/:factoryId/erp/ledger')
export class PartnerErpJournalsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly journals: ErpLedgerJournalsService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('journals')
  @Op({
    id: 'partner.erpJournals.list',
    summary: 'Journal entries',
    description: 'Newest first; by kind, status, month, account, source document or text (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.read',
    paginated: { type: ErpGlJournalDto, example: JOURNAL },
    errors: READ,
  })
  async list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlJournalListQuery) {
    return this.journals.list(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('journals')
  @Op({
    id: 'partner.erpJournals.create',
    summary: 'Draft a manual journal',
    description: 'Balanced lines on postable accounts (control accounts take documents only); `submit` sends it for approval. An accrual sets `autoReverseOn` (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.post',
    idempotent: true,
    etag: true,
    body: { type: ErpGlSaveJournalDto, example: MANUAL_BODY },
    success: { status: 201, description: 'Drafted', type: ErpGlJournalDto, example: { ...JOURNAL, kind: 'manual', status: 'draft', entryNo: null, postedAt: null, ruleKey: null, source: null, nextActions: [ACTION('erp_journal.edit'), ACTION('erp_journal.submit')] } },
    errors: [...WRITE, 'erp.ledger_unbalanced', 'erp.ledger_account_invalid', 'erp.ledger_period_closed'],
  })
  async create(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGlSaveJournalDto) {
    return this.journals.create(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('journals/:entryId')
  @Op({
    id: 'partner.erpJournals.get',
    summary: 'One journal entry',
    description: 'Its lines with dimensions and the document it came from (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.read',
    params: ['entryId'],
    etag: true,
    success: { status: 200, description: 'The entry', type: ErpGlJournalDto, example: JOURNAL },
  })
  async get(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('entryId', ParseUUIDPipe) entryId: string) {
    return this.journals.get(await this.workspace.open(actor, factoryId), entryId, await perms(this.permissions, actor));
  }

  @Put('journals/:entryId')
  @Op({
    id: 'partner.erpJournals.update',
    summary: 'Edit a draft manual journal',
    description: 'Replaces its lines (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.post',
    params: ['entryId'],
    concurrency: true,
    etag: true,
    body: { type: ErpGlSaveJournalDto, example: { ...MANUAL_BODY, submit: true } },
    success: { status: 200, description: 'Saved', type: ErpGlJournalDto, example: { ...JOURNAL, kind: 'manual', status: 'pending_approval', entryNo: null } },
    errors: [...WRITE, 'erp.ledger_journal_not_editable', 'erp.ledger_unbalanced', 'erp.ledger_account_invalid'],
  })
  async update(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('entryId', ParseUUIDPipe) entryId: string, @IfMatch() ifMatch: string | undefined, @Body() body: ErpGlSaveJournalDto) {
    return this.journals.update(await this.workspace.open(actor, factoryId), entryId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Delete('journals/:entryId')
  @Op({
    id: 'partner.erpJournals.delete',
    summary: 'Delete a draft manual journal',
    description: 'Only a draft; anything submitted stays as history (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.post',
    params: ['entryId'],
    status: 204,
    success: { status: 204, description: 'Deleted' },
    errors: ['http.not_found', 'erp.ledger_journal_not_editable'],
  })
  async remove(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('entryId', ParseUUIDPipe) entryId: string) {
    await this.journals.remove(await this.workspace.open(actor, factoryId), entryId);
  }

  @Post('journals/:entryId/actions/submit')
  @Op({
    id: 'partner.erpJournals.submit',
    summary: 'Submit a manual journal for approval',
    description: 'Maker-checker: someone else with `factory_ledger.approve` posts it (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.post',
    params: ['entryId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'Submitted', type: ErpGlJournalDto, example: { ...JOURNAL, kind: 'manual', status: 'pending_approval', entryNo: null } },
    errors: ['http.not_found', 'erp.ledger_journal_not_editable'],
  })
  async submit(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('entryId', ParseUUIDPipe) entryId: string) {
    return this.journals.submit(await this.workspace.open(actor, factoryId), entryId, await perms(this.permissions, actor));
  }

  @Post('journals/:entryId/actions/approve')
  @Op({
    id: 'partner.erpJournals.approve',
    summary: 'Approve and post a manual journal',
    description: 'Numbered `JV-YYMM-NNNN` and posted into its month, or the next open one; never your own (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.approve',
    params: ['entryId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'Posted', type: ErpGlJournalDto, example: { ...JOURNAL, kind: 'manual' } },
    errors: ['http.not_found', 'erp.ledger_journal_not_editable', 'erp.ledger_self_approval', 'erp.ledger_period_closed'],
  })
  async approve(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('entryId', ParseUUIDPipe) entryId: string) {
    return this.journals.approve(await this.workspace.open(actor, factoryId), entryId, await perms(this.permissions, actor));
  }

  @Post('journals/:entryId/actions/reject')
  @Op({
    id: 'partner.erpJournals.reject',
    summary: 'Reject a manual journal',
    description: 'It stays as history with the reason (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.approve',
    params: ['entryId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'บัญชีค่าใช้จ่ายไม่ถูกต้อง' } },
    success: { status: 200, description: 'Rejected', type: ErpGlJournalDto, example: { ...JOURNAL, kind: 'manual', status: 'rejected', entryNo: null, rejectionReason: 'บัญชีค่าใช้จ่ายไม่ถูกต้อง', nextActions: [] } },
    errors: [...WRITE, 'erp.ledger_journal_not_editable'],
  })
  async reject(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() body: ReasonDto) {
    return this.journals.reject(await this.workspace.open(actor, factoryId), entryId, body.reason, await perms(this.permissions, actor));
  }

  @Post('journals/:entryId/actions/reverse')
  @Op({
    id: 'partner.erpJournals.reverse',
    summary: 'Reverse a posted entry',
    description: 'A mirror entry dated `documentDate`; posted entries never change (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.post',
    params: ['entryId'],
    idempotent: true,
    status: 200,
    body: { type: ErpGlReverseJournalDto, example: { documentDate: '2026-11-01', reason: 'บันทึกซ้ำ' } },
    success: { status: 200, description: 'The reversal', type: ErpGlJournalDto, example: { ...JOURNAL, kind: 'reversal', reverses: { type: 'erp_gl_journal_entry', id: E6_IDS.entry, number: 'JV-2610-0012' }, nextActions: [] } },
    errors: [...WRITE, 'erp.ledger_journal_not_editable', 'erp.ledger_already_posted', 'erp.ledger_period_closed'],
  })
  async reverse(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() body: ErpGlReverseJournalDto) {
    return this.journals.reverse(await this.workspace.open(actor, factoryId), entryId, body, await perms(this.permissions, actor));
  }

  @Post('exports/journals')
  @Op({
    id: 'partner.erpJournals.export',
    summary: 'Export a month’s journal lines (CSV)',
    description: 'For an accountant’s own software (Express / PEAK / FlowAccount style); a short-lived link (D-396).',
    implements: ['D-396'],
    can: 'factory_ledger.read',
    idempotent: true,
    status: 200,
    body: { type: ErpGlMonthQuery, example: { month: '2026-10' } },
    success: { status: 200, description: 'The file', type: ErpTaxExportResultDto, example: { url: 'https://files.packio.example/erp/journals-2026-10.csv?sig=example', fileName: 'journals-2026-10.csv', expiresAt: '2026-10-14T10:05:00+07:00', rows: 184 } },
    errors: WRITE,
  })
  async export(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGlMonthQuery) {
    return this.journals.exportCsv(await this.workspace.open(actor, factoryId), body.month);
  }

  @Get('recurring-journals')
  @Op({
    id: 'partner.erpJournals.listRecurring',
    summary: 'Recurring journals',
    description: 'Posted on their day each month by the 00:30 job (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'Recurring journals', type: [ErpGlRecurringDto], example: [RECURRING] },
  })
  async listRecurring(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.journals.listRecurring(await this.workspace.open(actor, factoryId), await perms(this.permissions, actor));
  }

  @Post('recurring-journals')
  @Op({
    id: 'partner.erpJournals.createRecurring',
    summary: 'Add a recurring journal',
    description: 'Balanced lines on non-control accounts; an accrual reverses on the 1st of the next month (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.post',
    idempotent: true,
    etag: true,
    body: { type: ErpGlSaveRecurringDto, example: { name: RECURRING.name, description: RECURRING.description, dayOfMonth: 28, startOn: '2026-10-01', lines: RECURRING.lines } },
    success: { status: 201, description: 'Added', type: ErpGlRecurringDto, example: RECURRING },
    errors: [...WRITE, 'erp.ledger_unbalanced', 'erp.ledger_account_invalid'],
  })
  async createRecurring(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGlSaveRecurringDto) {
    return this.journals.createRecurring(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Put('recurring-journals/:recurringId')
  @Op({
    id: 'partner.erpJournals.updateRecurring',
    summary: 'Edit a recurring journal',
    description: '`status: inactive` stops it (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.post',
    params: ['recurringId'],
    concurrency: true,
    etag: true,
    body: { type: ErpGlSaveRecurringDto, example: { name: RECURRING.name, description: RECURRING.description, dayOfMonth: 25, startOn: '2026-10-01', lines: RECURRING.lines } },
    success: { status: 200, description: 'Saved', type: ErpGlRecurringDto, example: RECURRING },
    errors: [...WRITE, 'erp.ledger_unbalanced', 'erp.ledger_account_invalid'],
  })
  async updateRecurring(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('recurringId', ParseUUIDPipe) recurringId: string, @IfMatch() ifMatch: string | undefined, @Body() body: ErpGlSaveRecurringDto) {
    return this.journals.updateRecurring(await this.workspace.open(actor, factoryId), recurringId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post('recurring-journals/:recurringId/actions/run')
  @Op({
    id: 'partner.erpJournals.runRecurring',
    summary: 'Post this month’s recurring journal now',
    description: 'Once per month (D-389).',
    implements: ['D-389'],
    can: 'factory_ledger.post',
    params: ['recurringId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'The entry', type: ErpGlJournalDto, example: { ...JOURNAL, kind: 'recurring', ruleKey: null, source: null } },
    errors: ['http.not_found', 'erp.archived', 'erp.ledger_already_posted', 'erp.ledger_period_closed'],
  })
  async runRecurring(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('recurringId', ParseUUIDPipe) recurringId: string) {
    return this.journals.runRecurringNow(await this.workspace.open(actor, factoryId), recurringId, await perms(this.permissions, actor));
  }
}

// =========================================================================================== reports

@ApiSurface('partner', 'erpLedgerReports')
@Controller('factories/:factoryId/erp/ledger/reports')
export class PartnerErpLedgerReportsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly reports: ErpLedgerReportsService,
  ) {}

  @Get('trial-balance')
  @Op({
    id: 'partner.erpLedgerReports.trialBalance',
    summary: 'Trial balance',
    description: 'Opening, movements and closing per account for a date range (D-391).',
    implements: ['D-391'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'The trial balance', type: ErpGlTrialBalanceDto, example: TB },
    errors: READ,
  })
  async trialBalance(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlRangeQuery) {
    return this.reports.trialBalance(await this.workspace.open(actor, factoryId), q.from, q.to);
  }

  @Get('general-ledger')
  @Op({
    id: 'partner.erpLedgerReports.generalLedger',
    summary: 'General ledger of an account',
    description: 'Its lines with a running balance and the document each came from (D-391).',
    implements: ['D-391'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'The account’s ledger', type: ErpGlDetailDto, example: DETAIL },
    errors: READ,
  })
  async generalLedger(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlDetailQuery) {
    return this.reports.detail(await this.workspace.open(actor, factoryId), q.accountCode, q.from, q.to);
  }

  @Get('profit-and-loss')
  @Op({
    id: 'partner.erpLedgerReports.profitAndLoss',
    summary: 'Profit and loss',
    description: 'A month and the fiscal year to date, by DBD statement line (D-391).',
    implements: ['D-391'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'The statement', type: ErpGlProfitAndLossDto, example: PL },
    errors: READ,
  })
  async profitAndLoss(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlMonthQuery) {
    return this.reports.profitAndLoss(await this.workspace.open(actor, factoryId), q.month);
  }

  @Get('balance-sheet')
  @Op({
    id: 'partner.erpLedgerReports.balanceSheet',
    summary: 'Balance sheet',
    description: 'As of a day against the last fiscal year end, in the DBD NPAEs layout, with the current-year profit in equity (D-391).',
    implements: ['D-391'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'The statement', type: ErpGlBalanceSheetDto, example: BS },
    errors: READ,
  })
  async balanceSheet(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlAsOfQuery) {
    return this.reports.balanceSheet(await this.workspace.open(actor, factoryId), q.asOf);
  }

  @Get('cash-flow')
  @Op({
    id: 'partner.erpLedgerReports.cashFlow',
    summary: 'Cash flow',
    description: 'Indirect method by the accounts’ cash-flow class (D-391).',
    implements: ['D-391'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'The statement', type: ErpGlCashFlowDto, example: CF },
    errors: READ,
  })
  async cashFlow(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlRangeQuery) {
    return this.reports.cashFlow(await this.workspace.open(actor, factoryId), q.from, q.to);
  }

  @Get('stock-valuation')
  @Op({
    id: 'partner.erpLedgerReports.stockValuation',
    summary: 'Stock valuation against the books',
    description: 'Stock value by item kind (moving average, D-321) against its inventory account (D-390, D-391).',
    implements: ['D-390', 'D-391'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'The valuation', type: ErpGlStockValuationDto, example: STOCK },
    errors: READ,
  })
  async stockValuation(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlAsOfQuery) {
    return this.reports.stockValuation(await this.workspace.open(actor, factoryId), q.asOf);
  }
}

// ====================================================================================== fixed assets

@ApiSurface('partner', 'erpFixedAssets')
@Controller('factories/:factoryId/erp/ledger')
export class PartnerErpFixedAssetsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly assets: ErpLedgerAssetsService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('asset-categories')
  @Op({
    id: 'partner.erpFixedAssets.listCategories',
    summary: 'Asset categories',
    description: 'Useful life and the four accounts of each category (D-393).',
    implements: ['D-393'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'Categories', type: [ErpGlAssetCategoryDto], example: [CATEGORY] },
  })
  async categories(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.assets.listCategories(await this.workspace.open(actor, factoryId));
  }

  @Post('asset-categories')
  @Op({
    id: 'partner.erpFixedAssets.createCategory',
    summary: 'Add an asset category',
    description: 'Postable active accounts only (D-393).',
    implements: ['D-393'],
    can: 'factory_ledger.configure',
    idempotent: true,
    body: { type: ErpGlSaveAssetCategoryDto, example: { name: 'เครื่องจักร', usefulLifeMonths: 60, assetAccountCode: '1230', accumulatedAccountCode: '1239', expenseAccountCode: '5240', gainLossAccountCode: '4920' } },
    success: { status: 201, description: 'All categories', type: [ErpGlAssetCategoryDto], example: [CATEGORY] },
    errors: WRITE,
  })
  async createCategory(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGlSaveAssetCategoryDto) {
    return this.assets.saveCategory(await this.workspace.open(actor, factoryId), null, body);
  }

  @Put('asset-categories/:categoryId')
  @Op({
    id: 'partner.erpFixedAssets.updateCategory',
    summary: 'Edit an asset category',
    description: 'Assets already registered keep their own useful life (D-393).',
    implements: ['D-393'],
    can: 'factory_ledger.configure',
    params: ['categoryId'],
    body: { type: ErpGlSaveAssetCategoryDto, example: { name: 'เครื่องจักร', usefulLifeMonths: 84, assetAccountCode: '1230', accumulatedAccountCode: '1239', expenseAccountCode: '5240', gainLossAccountCode: '4920' } },
    success: { status: 200, description: 'All categories', type: [ErpGlAssetCategoryDto], example: [CATEGORY] },
    errors: WRITE,
  })
  async updateCategory(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('categoryId', ParseUUIDPipe) categoryId: string, @Body() body: ErpGlSaveAssetCategoryDto) {
    return this.assets.saveCategory(await this.workspace.open(actor, factoryId), categoryId, body);
  }

  @Get('fixed-assets')
  @Op({
    id: 'partner.erpFixedAssets.list',
    summary: 'Fixed-asset register',
    description: 'Cost, accumulated depreciation and net book value (D-393).',
    implements: ['D-393'],
    can: 'factory_ledger.read',
    paginated: { type: ErpGlAssetDto, example: ASSET },
    errors: READ,
  })
  async list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlAssetListQuery) {
    return this.assets.listAssets(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('fixed-assets')
  @Op({
    id: 'partner.erpFixedAssets.create',
    summary: 'Register an asset',
    description: '`FA-YYMM-NNNN`; straight line from the month after acquisition; depreciation taken before the ledger started is its opening accumulated (D-393).',
    implements: ['D-393'],
    can: 'factory_ledger.post',
    idempotent: true,
    etag: true,
    body: { type: ErpGlCreateAssetDto, example: { categoryId: E6_IDS.category, name: ASSET.name, acquiredOn: '2026-01-15', cost: '2400000.00', machineId: E6_IDS.machine } },
    success: { status: 201, description: 'Registered', type: ErpGlAssetDto, example: ASSET },
    errors: [...WRITE, 'erp.archived'],
  })
  async create(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGlCreateAssetDto) {
    return this.assets.createAsset(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('fixed-assets/:assetId')
  @Op({
    id: 'partner.erpFixedAssets.get',
    summary: 'One asset',
    description: 'With its ETag for disposal (D-393).',
    implements: ['D-393'],
    can: 'factory_ledger.read',
    params: ['assetId'],
    etag: true,
    success: { status: 200, description: 'The asset', type: ErpGlAssetDto, example: ASSET },
  })
  async get(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('assetId', ParseUUIDPipe) assetId: string) {
    return this.assets.getAsset(await this.workspace.open(actor, factoryId), assetId, await perms(this.permissions, actor));
  }

  @Post('fixed-assets/:assetId/actions/dispose')
  @Op({
    id: 'partner.erpFixedAssets.dispose',
    summary: 'Sell or write off an asset',
    description: 'Posts F16D: the asset and its accumulated depreciation out, the proceeds in, the difference to gain or loss (D-393).',
    implements: ['D-393'],
    can: 'factory_ledger.post',
    params: ['assetId'],
    idempotent: true,
    concurrency: true,
    status: 200,
    etag: true,
    body: { type: ErpGlDisposeAssetDto, example: { disposedOn: '2026-10-31', proceeds: '150000.00' } },
    success: { status: 200, description: 'Disposed', type: ErpGlAssetDto, example: { ...ASSET, status: 'disposed', disposedOn: '2026-10-31', proceeds: '150000.00', netBookValue: '0.00', nextActions: [] } },
    errors: [...WRITE, 'erp.ledger_asset_not_active', 'erp.ledger_period_closed'],
  })
  async dispose(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('assetId', ParseUUIDPipe) assetId: string, @IfMatch() ifMatch: string | undefined, @Body() body: ErpGlDisposeAssetDto) {
    return this.assets.disposeAsset(await this.workspace.open(actor, factoryId), assetId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Get('depreciation-runs')
  @Op({
    id: 'partner.erpFixedAssets.listRuns',
    summary: 'Depreciation runs',
    description: 'The last 24 months (D-393).',
    implements: ['D-393'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'Runs', type: [ErpGlDepreciationRunDto], example: [RUN] },
  })
  async runs(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.assets.listRuns(await this.workspace.open(actor, factoryId));
  }

  @Post('depreciation-runs')
  @Op({
    id: 'partner.erpFixedAssets.run',
    summary: 'Run a month’s depreciation',
    description: 'Once per month; catches up months not yet charged and posts F16 (D-393).',
    implements: ['D-393'],
    can: 'factory_ledger.post',
    idempotent: true,
    body: { type: ErpGlMonthQuery, example: { month: '2026-10' } },
    success: { status: 201, description: 'The run', type: ErpGlDepreciationRunDto, example: RUN },
    errors: [...WRITE, 'erp.ledger_depreciation_done', 'erp.ledger_period_closed'],
  })
  async run(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGlMonthQuery) {
    return this.assets.runDepreciation(await this.workspace.open(actor, factoryId), body.month);
  }
}

// ============================================================================================== bank

@ApiSurface('partner', 'erpBank')
@Controller('factories/:factoryId/erp/ledger')
export class PartnerErpBankController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly assets: ErpLedgerAssetsService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('bank-accounts')
  @Op({
    id: 'partner.erpBank.listAccounts',
    summary: 'Bank accounts',
    description: 'Each with its ledger balance and open statement lines (D-394).',
    implements: ['D-394'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'Bank accounts', type: [ErpGlBankAccountDto], example: [BANK] },
  })
  async accounts(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.assets.listBanks(await this.workspace.open(actor, factoryId), await perms(this.permissions, actor));
  }

  @Post('bank-accounts')
  @Op({
    id: 'partner.erpBank.createAccount',
    summary: 'Add a bank account',
    description: 'Gets its own sub-account under bank deposits; the last four digits only (D-394).',
    implements: ['D-394'],
    can: 'factory_ledger.configure',
    idempotent: true,
    etag: true,
    body: { type: ErpGlSaveBankAccountDto, example: { name: 'ออมทรัพย์', bankName: 'KBANK', accountNoLast4: '4321', isDefault: true } },
    success: { status: 201, description: 'Added', type: ErpGlBankAccountDto, example: BANK },
    errors: [...WRITE, 'erp.ledger_account_invalid'],
  })
  async createAccount(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGlSaveBankAccountDto) {
    return this.assets.createBank(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Put('bank-accounts/:bankAccountId')
  @Op({
    id: 'partner.erpBank.updateAccount',
    summary: 'Edit a bank account',
    description: 'Name, default, status (D-394).',
    implements: ['D-394'],
    can: 'factory_ledger.configure',
    params: ['bankAccountId'],
    concurrency: true,
    etag: true,
    body: { type: ErpGlSaveBankAccountDto, example: { name: 'ออมทรัพย์', bankName: 'KBANK', accountNoLast4: '4321', isDefault: true } },
    success: { status: 200, description: 'Saved', type: ErpGlBankAccountDto, example: BANK },
    errors: WRITE,
  })
  async updateAccount(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string, @IfMatch() ifMatch: string | undefined, @Body() body: ErpGlSaveBankAccountDto) {
    return this.assets.updateBank(await this.workspace.open(actor, factoryId), bankAccountId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post('bank-accounts/:bankAccountId/statements')
  @Op({
    id: 'partner.erpBank.importStatement',
    summary: 'Import a bank statement',
    description: 'Rows, or a CSV file in a known bank format; lines already imported are skipped; a single same-amount payment or receipt within 3 days is matched automatically (D-394).',
    implements: ['D-394'],
    can: 'factory_ledger.post',
    params: ['bankAccountId'],
    idempotent: true,
    body: { type: ErpGlImportStatementDto, example: { rows: [{ txnDate: '2026-10-12', amount: '-12500.00', description: 'โอนเงิน บจก.กระดาษ ทดสอบ', reference: 'TRF2026101200123' }] } },
    success: { status: 201, description: 'Imported', type: ErpGlImportResultDto, example: { imported: 25, duplicates: 3, autoMatched: 18 } },
    errors: [...WRITE, 'erp.archived', 'erp.ledger_bank_file_invalid'],
  })
  async importStatement(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string, @Body() body: ErpGlImportStatementDto) {
    return this.assets.importStatement(await this.workspace.open(actor, factoryId), bankAccountId, body);
  }

  @Get('bank-lines')
  @Op({
    id: 'partner.erpBank.listLines',
    summary: 'Bank statement lines',
    description: 'Newest first, with matches and, for open lines, possible matches (D-394).',
    implements: ['D-394'],
    can: 'factory_ledger.read',
    paginated: { type: ErpGlBankLineDto, example: LINE },
    errors: READ,
  })
  async lines(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpGlBankLineListQuery) {
    return this.assets.listLines(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('bank-lines/:lineId/actions/match')
  @Op({
    id: 'partner.erpBank.matchLine',
    summary: 'Match a statement line',
    description: 'To a supplier payment, a customer receipt or a posted entry; a bank fee or interest posts F18 (D-394).',
    implements: ['D-394'],
    can: 'factory_ledger.post',
    params: ['lineId'],
    idempotent: true,
    status: 200,
    body: { type: ErpGlMatchBankLineDto, example: { targetType: 'supplier_payment', targetId: E6_IDS.payment } },
    success: { status: 200, description: 'Matched', type: ErpGlBankLineDto, example: { ...LINE, matches: [{ ...MATCH, auto: false, matchedBy: 'ฝ่ายบัญชีโรงงาน ทดสอบ' }] } },
    errors: [...WRITE, 'erp.ledger_bank_line_settled', 'erp.ledger_period_closed'],
  })
  async match(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() body: ErpGlMatchBankLineDto) {
    return this.assets.matchLine(await this.workspace.open(actor, factoryId), lineId, body, await perms(this.permissions, actor));
  }

  @Post('bank-lines/:lineId/actions/ignore')
  @Op({
    id: 'partner.erpBank.ignoreLine',
    summary: 'Ignore a statement line',
    description: 'With a reason (an internal transfer already recorded, say), D-394.',
    implements: ['D-394'],
    can: 'factory_ledger.post',
    params: ['lineId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'โอนระหว่างบัญชีของบริษัทเอง' } },
    success: { status: 200, description: 'Ignored', type: ErpGlBankLineDto, example: { ...LINE, status: 'ignored', ignoreReason: 'โอนระหว่างบัญชีของบริษัทเอง', matches: [] } },
    errors: [...WRITE, 'erp.ledger_bank_line_settled'],
  })
  async ignore(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() body: ReasonDto) {
    return this.assets.ignoreLine(await this.workspace.open(actor, factoryId), lineId, body.reason, await perms(this.permissions, actor));
  }

  @Post('bank-lines/:lineId/actions/unmatch')
  @Op({
    id: 'partner.erpBank.unmatchLine',
    summary: 'Undo a match or an ignore',
    description: 'A fee or interest entry is reversed (D-394).',
    implements: ['D-394'],
    can: 'factory_ledger.post',
    params: ['lineId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'Open again', type: ErpGlBankLineDto, example: { ...LINE, status: 'open', matches: [], nextActions: [ACTION('erp_bank_line.match'), ACTION('erp_bank_line.ignore')] } },
    errors: ['http.not_found', 'erp.ledger_bank_line_settled'],
  })
  async unmatch(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('lineId', ParseUUIDPipe) lineId: string) {
    return this.assets.unmatchLine(await this.workspace.open(actor, factoryId), lineId, await perms(this.permissions, actor));
  }

  @Get('cash-position')
  @Op({
    id: 'partner.erpBank.cashPosition',
    summary: 'Cash position',
    description: 'Cash and bank balances today, what is not yet reconciled, and what falls due within a week (D-394).',
    implements: ['D-394'],
    can: 'factory_ledger.read',
    success: { status: 200, description: 'The position', type: ErpGlCashPositionDto, example: { asOf: '2026-10-14', cashOnHand: '12000.00', banks: [{ account: BANK, unreconciled: '-12500.00' }], total: '197000.00', payablesDue7d: '56000.00', receivablesDue7d: '82000.00' } },
  })
  async cashPosition(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.assets.cashPosition(await this.workspace.open(actor, factoryId), await perms(this.permissions, actor));
  }
}
