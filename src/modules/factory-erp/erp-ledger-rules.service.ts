import { DomainException } from '@common/errors/domain.exception';
import { assertExpression, ExpressionError, expressionPaths } from '@common/ledger-core/expression';
import { type AccountSelector, type PostingTemplate, renderJournal, TemplateError, type TemplateLine, validateTemplate } from '@common/ledger-core/template';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { bangkokDate } from '@common/time/bangkok';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import {
  type ErpGlConditionDto,
  type ErpGlPreviewDto,
  type ErpGlRuleDetailDto,
  type ErpGlRuleVersionDto,
  type ErpGlTemplateDto,
  type ErpGlTemplateLineDto,
} from './erp-e6.dto';
import { ErpLedgerService, money } from './erp-ledger.service';
import { ERP_GL_DIMENSIONS, METHOD_ACCOUNTS, RULE_VARIABLES, type RuleVariable } from './erp-ledger.template';
import { ErpLedgerPostingService } from './erp-ledger-posting.service';
import { isoTs } from './erp-sales.shared';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/**
 * D-398: editing a posting rule. A change is a new rule version — proposed by one person (`factory_ledger.configure`),
 * approved by another (`factory_ledger.approve`), in force from its day; versions are never edited, so every entry
 * keeps pointing at the version that posted it. The editor works on a structured shape of the template (fixed or
 * document account, side, amount expression, tax code, a simple condition, repeat-for-each) that maps 1:1 onto the
 * stored template; the document date, source and default dimensions are kept from the version in force.
 */

const RULE_ACTIONS: ActionRule<{ pending: boolean }>[] = [
  { key: 'erp_rule.propose', permissions: ['factory_ledger.configure'], when: (r) => (r.pending ? 'มีฉบับแก้ไขรออนุมัติอยู่' : true) },
];
const VERSION_ACTIONS: ActionRule<{ status: string; own: boolean }>[] = [
  { key: 'erp_rule_version.approve', permissions: ['factory_ledger.approve'], when: (v) => (v.status !== 'proposed' ? false : v.own ? 'อนุมัติฉบับที่ตัวเองเสนอไม่ได้' : true) },
  { key: 'erp_rule_version.reject', permissions: ['factory_ledger.approve'], when: (v) => v.status === 'proposed' && !v.own },
  { key: 'erp_rule_version.withdraw', permissions: ['factory_ledger.configure'], when: (v) => v.status === 'proposed' && v.own },
];

type VersionRow = Prisma.ErpGlPostingRuleVersionGetPayload<{ include: { createdBy: true; decidedBy: true } }>;

/** Stored `when` value from the editor's text (`true` / `false`, a number, or text). */
const conditionValue = (raw: string): string | number | boolean => {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
};

/** The editor's shape of a stored template line. */
export function lineToDto(line: TemplateLine): ErpGlTemplateLineDto {
  const account = line.account;
  const when = line.when as { field?: unknown; op?: unknown; value?: unknown } | undefined;
  return {
    forEach: line.forEach ?? null,
    when:
      when && typeof when.field === 'string' && typeof when.op === 'string'
        ? { field: when.field.replace(/^payload\./, ''), op: when.op, value: String(when.value) }
        : null,
    accountCode: typeof account === 'string' ? account : null,
    accountPath: typeof account === 'object' && 'path' in account ? account.path : null,
    side: line.side,
    amount: line.amount,
    description: line.description ?? null,
    taxCode: typeof line.taxCode === 'string' ? line.taxCode : null,
    taxBase: line.taxBase ?? null,
    ...(line.dimensions ? { dimensions: line.dimensions as Record<string, string> } : {}),
  };
}

export function templateToDto(t: PostingTemplate): ErpGlTemplateDto {
  return { description: t.description, lines: t.lines.map(lineToDto) };
}

/** The stored template for the editor's shape; header fields other than the description come from `base`. */
export function templateFromDto(dto: ErpGlTemplateDto, base: PostingTemplate | null): PostingTemplate {
  const lines: TemplateLine[] = dto.lines.map((l) => {
    const account: AccountSelector = l.accountCode ? l.accountCode : { path: l.accountPath ?? '' };
    const when: ErpGlConditionDto | null | undefined = l.when;
    return {
      ...(l.forEach ? { forEach: l.forEach } : {}),
      ...(when ? { when: { field: `payload.${when.field}`, op: when.op, value: conditionValue(when.value) } } : {}),
      account,
      side: l.side as 'debit' | 'credit',
      amount: l.amount.trim(),
      ...(l.description ? { description: l.description } : {}),
      ...(l.dimensions && Object.keys(l.dimensions).length ? { dimensions: l.dimensions } : {}),
      ...(l.taxCode ? { taxCode: l.taxCode as TemplateLine['taxCode'] } : {}),
      ...(l.taxBase ? { taxBase: l.taxBase.trim() } : {}),
    };
  });
  return {
    description: dto.description.trim(),
    ...(base?.documentDate ? { documentDate: base.documentDate } : {}),
    ...(base?.source ? { source: base.source } : {}),
    ...(base?.dimensions ? { dimensions: base.dimensions } : {}),
    lines,
  };
}

/**
 * What the editor's template gets wrong for this rule (empty = fine): structure, accounts (a fixed code must be a
 * postable active account; a document account must be one the payload carries), and paths the payload does not
 * have. Messages are Thai — they are shown as they are.
 */
export function templateIssues(
  dto: ErpGlTemplateDto,
  variables: readonly RuleVariable[],
  accounts: ReadonlyMap<string, { isPostable: boolean; status: string }>,
): string[] {
  const out: string[] = [];
  const purposes = Object.keys(METHOD_ACCOUNTS);
  const known = new Set(variables.map((v) => v.path));
  const ofKind = (kind: RuleVariable['kind']) => new Set(variables.filter((v) => v.kind === kind).map((v) => v.path));
  const accountPaths = ofKind('account');
  const lists = ofKind('list');
  const readable = (path: string, inLoop: boolean) =>
    path.startsWith('accounts.') ? purposes.includes(path.slice('accounts.'.length)) : known.has(path) && (inLoop || !path.startsWith('item.'));
  dto.lines.forEach((l, i) => {
    const at = `บรรทัด ${i + 1}`;
    const inLoop = !!l.forEach;
    if (l.forEach && !lists.has(l.forEach)) out.push(`${at}: "${l.forEach}" ไม่ใช่รายการที่เอกสารนี้มี`);
    if (!!l.accountCode === !!l.accountPath) out.push(`${at}: เลือกบัญชีคงที่ หรือบัญชีจากเอกสาร อย่างใดอย่างหนึ่ง`);
    if (l.accountCode) {
      const a = accounts.get(l.accountCode);
      if (!a) out.push(`${at}: ไม่มีบัญชี ${l.accountCode} ในผังบัญชี`);
      else if (!a.isPostable || a.status !== 'active') out.push(`${at}: บัญชี ${l.accountCode} ไม่ใช่บัญชีที่ลงรายการได้`);
    }
    if (l.accountPath) {
      const purpose = l.accountPath.startsWith('accounts.') ? l.accountPath.slice('accounts.'.length) : null;
      const ok = purpose ? purposes.includes(purpose) : accountPaths.has(l.accountPath) && (inLoop || !l.accountPath.startsWith('item.'));
      if (!ok) out.push(`${at}: "${l.accountPath}" ไม่ใช่บัญชีที่เอกสารนี้ระบุ`);
    }
    for (const [label, expr] of [
      ['จำนวนเงิน', l.amount],
      ['ฐานภาษี', l.taxBase],
    ] as const) {
      if (!expr) continue;
      try {
        assertExpression(expr);
        for (const p of expressionPaths(expr)) if (!readable(p, inLoop)) out.push(`${at}: ${label} อ่าน "${p}" ซึ่งเอกสารนี้ไม่มี`);
      } catch (error) {
        if (error instanceof ExpressionError) out.push(`${at}: ${label} — สูตรไม่ถูกต้อง (${error.message})`);
        else throw error;
      }
    }
    if (l.taxBase && !l.taxCode) out.push(`${at}: ระบุรหัสภาษีเมื่อมีฐานภาษี`);
    if (l.when && !readable(l.when.field, inLoop)) out.push(`${at}: เงื่อนไขอ่าน "${l.when.field}" ซึ่งเอกสารนี้ไม่มี`);
  });
  return out;
}

@Injectable()
export class ErpLedgerRulesService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly ledger: ErpLedgerService,
    private readonly posting: ErpLedgerPostingService,
    private readonly audit: AuditService,
  ) {}

  private variablesOf(eventType: string): RuleVariable[] {
    return RULE_VARIABLES[eventType] ?? [];
  }

  async getRule(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpGlRuleDetailDto> {
    await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const rule = await this.workspace.db.erpGlPostingRule.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: { versions: { include: { createdBy: true, decidedBy: true }, orderBy: { versionNo: 'desc' } } },
    });
    if (!rule) throw new DomainException('http.not_found');
    const now = new Date();
    const current = rule.versions
      .filter((v) => v.status === 'approved' && v.effectiveFrom <= now)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.versionNo - a.versionNo)[0];
    const pending = rule.versions.some((v) => v.status === 'proposed');
    return {
      id: rule.publicId,
      key: rule.key,
      eventType: rule.eventType,
      name: rule.name,
      description: rule.description,
      versions: rule.versions.map((v) => this.versionDto(v, v.id === current?.id, scope, perms)),
      variables: this.variablesOf(rule.eventType).map((v) => ({ path: v.path, kind: v.kind, label: v.th })),
      purposes: Object.keys(METHOD_ACCOUNTS),
      nextActions: nextActions({ pending }, RULE_ACTIONS, perms),
    };
  }

  private versionDto(v: VersionRow, current: boolean, scope: ErpScope, perms: ReadonlySet<string>): ErpGlRuleVersionDto {
    return {
      id: v.publicId,
      versionNo: v.versionNo,
      status: v.status,
      effectiveFrom: isoTs(v.effectiveFrom)!,
      current,
      template: templateToDto(v.template as unknown as PostingTemplate),
      reason: v.reason,
      createdBy: v.createdBy?.displayName ?? null,
      createdAt: isoTs(v.createdAt)!,
      decidedBy: v.decidedBy?.displayName ?? null,
      decidedAt: isoTs(v.decidedAt),
      nextActions: nextActions({ status: v.status, own: v.createdById === scope.actor.userId }, VERSION_ACTIONS, perms),
    };
  }

  /** Every problem with the editor's template for this rule, structural and against the chart. */
  private async problems(scope: ErpScope, eventType: string, dto: ErpGlTemplateDto, base: PostingTemplate | null): Promise<{ template: PostingTemplate; issues: string[] }> {
    const accounts = await this.workspace.db.erpGlAccount.findMany({ where: { factoryId: scope.factory.id }, select: { code: true, isPostable: true, status: true } });
    const issues = templateIssues(dto, this.variablesOf(eventType), new Map(accounts.map((a) => [a.code, a])));
    const template = templateFromDto(dto, base);
    if (!issues.length) issues.push(...validateTemplate(template, ERP_GL_DIMENSIONS));
    return { template, issues };
  }

  private async currentTemplate(ruleId: bigint): Promise<PostingTemplate | null> {
    const v = await this.workspace.db.erpGlPostingRuleVersion.findFirst({
      where: { ruleId, status: 'approved', effectiveFrom: { lte: new Date() } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    return v ? (v.template as unknown as PostingTemplate) : null;
  }

  /** Renders the template against the factory's latest document of the rule's kind (D-398). */
  async preview(scope: ErpScope, publicId: string, dto: ErpGlTemplateDto): Promise<ErpGlPreviewDto> {
    const settings = await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const rule = await this.workspace.db.erpGlPostingRule.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!rule) throw new DomainException('http.not_found');
    const { template, issues } = await this.problems(scope, rule.eventType, dto, await this.currentTemplate(rule.id));
    return this.render(scope, rule.eventType, template, issues, settings);
  }

  private async render(
    scope: ErpScope,
    eventType: string,
    template: PostingTemplate,
    issues: string[],
    settings: Awaited<ReturnType<ErpLedgerService['book']>>,
  ): Promise<ErpGlPreviewDto> {
    const empty = { sampleNo: null, sampleAt: null, description: template.description, lines: [], totalDebit: '0.00', totalCredit: '0.00', balanced: true };
    if (issues.length) return { ...empty, problems: issues };
    const sample = await this.posting.samplePayload(scope.factory, settings, eventType);
    if (!sample) return { ...empty, problems: [] };
    const base = { sampleNo: (sample.payload['documentNo'] as string | undefined) ?? null, sampleAt: isoTs(new Date(sample.occurredAt)) };
    let journal;
    try {
      journal = renderJournal(template, sample.payload);
    } catch (error) {
      if (error instanceof TemplateError || error instanceof ExpressionError) return { ...empty, ...base, problems: [`คำนวณไม่ได้: ${error.message}`] };
      throw error;
    }
    const names = new Map(
      (await this.workspace.db.erpGlAccount.findMany({ where: { factoryId: scope.factory.id, code: { in: journal.lines.map((l) => l.accountCode) } }, select: { code: true, nameTh: true } })).map((a) => [a.code, a.nameTh]),
    );
    const balanced = journal.totalDebit.eq(journal.totalCredit);
    const problems = [
      ...journal.lines.filter((l) => !names.has(l.accountCode)).map((l) => `ไม่มีบัญชี ${l.accountCode} ในผังบัญชี`),
      ...(balanced ? [] : [`เดบิต ${money(journal.totalDebit)} ไม่เท่ากับเครดิต ${money(journal.totalCredit)}`]),
    ];
    return {
      ...base,
      description: journal.description,
      lines: journal.lines.map((l) => ({
        accountCode: l.accountCode,
        accountName: names.get(l.accountCode) ?? null,
        side: l.side,
        amount: money(l.amount),
        description: l.description,
        taxCode: l.taxCode,
      })),
      totalDebit: money(journal.totalDebit),
      totalCredit: money(journal.totalCredit),
      balanced,
      problems,
    };
  }

  /** Proposes a new version; refused while another waits, when the template has problems or the sample does not balance. */
  async propose(scope: ErpScope, publicId: string, body: { template: ErpGlTemplateDto; effectiveFrom: string; reason: string }, perms: ReadonlySet<string>): Promise<ErpGlRuleDetailDto> {
    const settings = await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const rule = await this.workspace.db.erpGlPostingRule.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!rule) throw new DomainException('http.not_found');
    const fail = (path: string, message: string) => new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    if (body.effectiveFrom < bangkokDate(new Date())) throw fail('effectiveFrom', 'วันที่มีผลต้องเป็นวันนี้หรือหลังจากนี้');
    const { template, issues } = await this.problems(scope, rule.eventType, body.template, await this.currentTemplate(rule.id));
    const preview = await this.render(scope, rule.eventType, template, issues, settings);
    if (preview.problems.length) throw new DomainException('validation.failed', { errors: preview.problems.map((message) => ({ path: 'template', code: 'invalid', message })) });
    await this.workspace.tx(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM erp_gl_posting_rules WHERE id = ${rule.id} FOR UPDATE`);
      if (await tx.erpGlPostingRuleVersion.findFirst({ where: { ruleId: rule.id, status: 'proposed' }, select: { id: true } }))
        throw new DomainException('erp.ledger_version_pending', { params: { key: rule.key } });
      const last = await tx.erpGlPostingRuleVersion.findFirst({ where: { ruleId: rule.id }, orderBy: { versionNo: 'desc' }, select: { versionNo: true } });
      const version = await tx.erpGlPostingRuleVersion.create({
        data: {
          ruleId: rule.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom: new Date(`${body.effectiveFrom}T00:00:00+07:00`),
          status: 'proposed',
          template: template as unknown as Prisma.InputJsonValue,
          reason: body.reason,
          createdById: scope.actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'erp_ledger.rule_version_proposed',
        resourceType: 'erp_gl_posting_rule_version',
        resourcePublicId: version.publicId,
        data: { rule: rule.key, versionNo: version.versionNo, effectiveFrom: body.effectiveFrom },
      });
      await this.workspace.record(tx, scope, 'erp_ledger.rule_version_proposed', 'erp_gl_posting_rule', rule.publicId, { versionNo: version.versionNo });
    });
    return this.getRule(scope, publicId, perms);
  }

  /** Approve / reject (another person, `factory_ledger.approve`) or withdraw (the proposer) a waiting version. */
  async decide(scope: ErpScope, rulePublicId: string, versionPublicId: string, decision: 'approve' | 'reject' | 'withdraw', note: string | null, perms: ReadonlySet<string>): Promise<ErpGlRuleDetailDto> {
    await this.workspace.tx(async (tx) => {
      const v = await tx.erpGlPostingRuleVersion.findFirst({
        where: { publicId: versionPublicId, rule: { factoryId: scope.factory.id, publicId: rulePublicId } },
        include: { rule: true },
      });
      if (!v) throw new DomainException('http.not_found');
      if (v.status !== 'proposed') throw new DomainException('erp.invalid_status', { params: { status: v.status } });
      const own = v.createdById === scope.actor.userId;
      if (decision === 'withdraw' && !own) throw new DomainException('http.not_found');
      if (decision !== 'withdraw' && own) throw new DomainException('erp.ledger_self_approval');
      if (decision === 'approve') {
        // the chart may have changed since the proposal
        const accounts = await tx.erpGlAccount.findMany({ where: { factoryId: scope.factory.id }, select: { code: true, isPostable: true, status: true } });
        const issues = templateIssues(templateToDto(v.template as unknown as PostingTemplate), this.variablesOf(v.rule.eventType), new Map(accounts.map((a) => [a.code, a])));
        if (issues.length) throw new DomainException('validation.failed', { errors: issues.map((message) => ({ path: 'template', code: 'invalid', message })) });
      }
      const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'withdrawn';
      await tx.erpGlPostingRuleVersion.update({
        where: { id: v.id },
        data: { status, decidedAt: new Date(), decidedById: scope.actor.userId },
      });
      const action = `erp_ledger.rule_version_${status}`;
      await this.audit.record(tx, {
        category: 'config',
        action,
        resourceType: 'erp_gl_posting_rule_version',
        resourcePublicId: v.publicId,
        data: { rule: v.rule.key, versionNo: v.versionNo, effectiveFrom: bangkokDate(v.effectiveFrom), ...(note ? { note } : {}) },
      });
      await this.workspace.record(tx, scope, action, 'erp_gl_posting_rule', v.rule.publicId, { versionNo: v.versionNo });
    });
    return this.getRule(scope, rulePublicId, perms);
  }
}
