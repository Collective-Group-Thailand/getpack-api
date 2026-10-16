/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- loose response bodies (see Rec) */
import { createHash, randomUUID } from 'node:crypto';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { as, foldingBackToRfq, foldingReady, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

/**
 * getpack Factory ERP E6 (docs/prompts/E6-factory-general-ledger.md, D-385 – D-396): the book starts from the
 * templates, a chart change under maker-checker, a manual journal drafted by the accountant and posted by the owner,
 * reversed; stock posted from the ERP and caught up into the books (stock valuation = inventory accounts); bank
 * import with a fee; a fixed asset depreciated; the close checklist; reports that balance; who may do what (D-396)
 * and privacy (staff 403).
 */
describe('getpack Factory ERP E6 (e2e)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let owner: string;
  let accountant: string;
  let auditor: string;
  let operator: string;
  let base: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 801);
    accountant = await factoryToken(ctx, fixture.factoryPublicId, 'factory_accountant', 802);
    auditor = await factoryToken(ctx, fixture.factoryPublicId, 'factory_auditor', 803);
    operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 804);
    base = `/v1/partner/factories/${fixture.factoryPublicId}/erp`;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const post = async (token: string, path: string, body: object = {}, status = 200) =>
    (await as(ctx, token).post(`${base}${path}`).set('Idempotency-Key', randomUUID()).send(body).expect(status)).body as Rec;
  const put = async (token: string, path: string, body: object, id: string, version: number, status = 200) =>
    (await as(ctx, token).put(`${base}${path}`).set('If-Match', etag(id, version)).send(body).expect(status)).body as Rec;
  const get = async (path: string, token = owner, status = 200) => (await as(ctx, token).get(`${base}${path}`).expect(status)).body as Rec;
  const etag = (id: string, version: number) => `"${createHash('sha256').update(`${id}|${version}`).digest('base64url').slice(0, 27)}"`;
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  it('starts the book and changes the chart under maker-checker (D-385 – D-387)', async () => {
    const settings = await get('/ledger/settings');
    expect(settings).toMatchObject({ accounts: expect.any(Number), rules: expect.any(Number), itemKindAccounts: { raw_material: '1141' } });
    expect(settings.accounts).toBeGreaterThan(60);
    await put(owner, '/ledger/settings', { ledgerStartOn: `${month}-01`, cpaName: 'สำนักงานบัญชี E6' }, settings.id, settings.version);

    const change = await post(owner, '/ledger/account-changes', {
      kind: 'create',
      proposed: { code: '1147', nameTh: 'หมึกพิมพ์', nameEn: 'Printing ink', accountType: 'asset', parentCode: '1100', cashFlowClass: 'operating', statementLine: 'inventory' },
      reason: 'แยกหมึกพิมพ์',
    }, 201);
    await post(owner, `/ledger/account-changes/${change.id}/actions/approve`, {}, 403); // never one's own
    await as(ctx, accountant).post(`${base}/ledger/account-changes/${change.id}/actions/approve`).set('Idempotency-Key', randomUUID()).send({}).expect(403); // no approve grant
    const accounts = await get('/ledger/accounts?q=1147');
    expect(accounts.data).toHaveLength(0);
    const rules = await get('/ledger/rules');
    expect(rules.map((r: Rec) => r.key)).toEqual(expect.arrayContaining(['F01', 'F02', 'F03', 'F08', 'F10', 'F16']));
  });

  it('posts a manual journal through maker-checker and reverses it (D-389)', async () => {
    const draft = await post(accountant, '/ledger/journals', {
      documentDate: today,
      description: 'ค่าเช่าโรงงาน E6',
      lines: [
        { accountCode: '6150', side: 'debit', amount: '15000.00' },
        { accountCode: '2140', side: 'credit', amount: '15000.00' },
      ],
      submit: true,
    }, 201);
    expect(draft).toMatchObject({ kind: 'manual', status: 'pending_approval', entryNo: null });
    // control accounts never take manual lines; an unbalanced journal is refused
    await post(accountant, '/ledger/journals', { documentDate: today, description: 'x', lines: [{ accountCode: '1131', side: 'debit', amount: '1.00' }, { accountCode: '4110', side: 'credit', amount: '1.00' }] }, 422);
    await post(accountant, '/ledger/journals', { documentDate: today, description: 'x', lines: [{ accountCode: '6150', side: 'debit', amount: '2.00' }, { accountCode: '2140', side: 'credit', amount: '1.00' }] }, 422);

    const posted = await post(owner, `/ledger/journals/${draft.id}/actions/approve`);
    expect(posted).toMatchObject({ status: 'posted', entryNo: expect.stringMatching(/^JV-\d{4}-\d{4}$/), totalDebit: '15000.00' });
    const reversal = await post(accountant, `/ledger/journals/${draft.id}/actions/reverse`, { documentDate: today, reason: 'บันทึกซ้ำ' });
    expect(reversal).toMatchObject({ kind: 'reversal', status: 'posted' });
    await post(accountant, `/ledger/journals/${draft.id}/actions/reverse`, { documentDate: today, reason: 'อีกครั้ง' }, 409);
    // the database refuses to change a posted entry
    await expect(ctx.prisma.erpGlJournalEntry.update({ where: { publicId: posted.id }, data: { description: 'x' } })).rejects.toThrow();
  });

  it('books stock from the ERP and reconciles it (D-388, D-390, D-391)', async () => {
    const item = (await as(ctx, owner).post(`${base}/items`).send({ sku: `E6-PAP-${ctx.run}`, name: 'กระดาษ E6', kind: 'raw_material', baseUnit: 'sheet' }).expect(201)).body as Rec;
    await post(owner, '/stock/actions/adjust', { kind: 'opening', lines: [{ itemId: item.id, quantity: '1000', unitCost: '2.50' }] });
    await post(owner, '/stock/actions/adjust', { kind: 'adjustment', reason: 'แตกเสียหาย', lines: [{ itemId: item.id, quantity: '-100' }] });
    const caught = await post(owner, '/ledger/actions/catch-up');
    expect(caught.failed).toEqual([]);
    const journals = await get(`/ledger/journals?kind=auto&month=${month}`);
    expect(journals.data.length).toBeGreaterThanOrEqual(2);
    const valuation = await get(`/ledger/reports/stock-valuation?asOf=${today}`);
    expect(valuation.rows.find((r: Rec) => r.kind === 'raw_material')).toMatchObject({ difference: '0.00' });
    const tb = await get(`/ledger/reports/trial-balance?from=${month}-01&to=${today}`);
    expect(tb.balanced).toBe(true);
    const bs = await get(`/ledger/reports/balance-sheet?asOf=${today}`);
    expect(bs.balanced).toBe(true);
    const pl = await get(`/ledger/reports/profit-and-loss?month=${month}`);
    expect(pl.netProfit).toMatch(/^-?\d+\.\d{2}$/);
  });

  it('imports a statement, books a fee, depreciates an asset and checks the close (D-390, D-393, D-394)', async () => {
    const bank = await post(owner, '/ledger/bank-accounts', { name: 'ออมทรัพย์ E6', bankName: 'KBANK', accountNoLast4: '4321' }, 201);
    expect(bank.glAccount.code).toMatch(/^112/);
    const rows = [{ txnDate: today, amount: '-25.00', description: 'ค่าธรรมเนียม', reference: null }];
    expect(await post(accountant, `/ledger/bank-accounts/${bank.id}/statements`, { rows }, 201)).toMatchObject({ imported: 1 });
    expect(await post(accountant, `/ledger/bank-accounts/${bank.id}/statements`, { rows }, 201)).toMatchObject({ imported: 0, duplicates: 1 });
    const lines = await get(`/ledger/bank-lines?bankAccountId=${bank.id}&status=open`);
    const fee = await post(accountant, `/ledger/bank-lines/${lines.data[0].id}/actions/match`, { targetType: 'bank_fee' });
    expect(fee.matches[0].entry).toMatchObject({ number: expect.stringMatching(/^JV-/) });

    await post(owner, '/ledger/asset-categories', { name: `เครื่องจักร E6 ${ctx.run}`, usefulLifeMonths: 60, assetAccountCode: '1230', accumulatedAccountCode: '1239', expenseAccountCode: '5240', gainLossAccountCode: '4920' }, 201);
    const category = (await get('/ledger/asset-categories')).find((c: Rec) => c.name === `เครื่องจักร E6 ${ctx.run}`);
    const asset = await post(accountant, '/ledger/fixed-assets', { categoryId: category.id, name: 'เครื่องพับ E6', acquiredOn: `${month}-01`, cost: '120000.00', depreciationStart: `${month}-01` }, 201);
    expect(asset).toMatchObject({ monthlyDepreciation: '2000.00', assetNo: expect.stringMatching(/^FA-/) });
    const run = await post(accountant, '/ledger/depreciation-runs', { month }, 201);
    expect(run).toMatchObject({ total: '2000.00', entry: { number: expect.stringMatching(/^JV-/) } });
    await post(accountant, '/ledger/depreciation-runs', { month }, 409);

    const period = (await get('/ledger/periods')).find((p: Rec) => p.month === month);
    const checklist = await get(`/ledger/periods/${period.id}/checklist`);
    expect(checklist.checks.find((c: Rec) => c.key === 'depreciation')).toMatchObject({ ok: true });
    expect(checklist.checks.find((c: Rec) => c.key === 'bank')).toMatchObject({ ok: true });
    await post(operator, `/ledger/periods/${period.id}/actions/transition`, { action: 'soft_close' }, 403);
    const soft = await post(accountant, `/ledger/periods/${period.id}/actions/transition`, { action: 'soft_close' });
    expect(soft.status).toBe('soft_closed');
    const reopened = await post(accountant, `/ledger/periods/${period.id}/actions/transition`, { action: 'reopen', note: 'ลืมบันทึก' });
    expect(reopened.status).toBe('open');
  });

  it('edits a posting rule as a new version under maker-checker (D-398) and has getpack rules F14 / F15 (D-397)', async () => {
    const rules = await get('/ledger/rules');
    expect(rules.map((r: Rec) => r.key)).toEqual(expect.arrayContaining(['F14', 'F15']));
    const f01 = rules.find((r: Rec) => r.key === 'F01');
    const detail = await get(`/ledger/rules/${f01.id}`);
    expect(detail.versions[0]).toMatchObject({ versionNo: 1, status: 'approved', current: true });
    expect(detail.variables.map((v: Rec) => v.path)).toContain('goodsValue');
    const template = detail.versions[0].template;

    const bad = await post(owner, `/ledger/rules/${f01.id}/actions/preview`, { template: { ...template, lines: [{ ...template.lines[0], accountCode: '9999', accountPath: null }] } });
    expect(bad.problems.length).toBeGreaterThan(0);
    await post(owner, `/ledger/rules/${f01.id}/versions`, { template: { ...template, lines: [{ ...template.lines[0], amount: 'nope' }] }, effectiveFrom: today, reason: 'ทดสอบ' }, 422);

    const proposed = await post(owner, `/ledger/rules/${f01.id}/versions`, { template: { ...template, description: 'รับสินค้า {documentNo}' }, effectiveFrom: today, reason: 'ย่อคำอธิบาย' }, 201);
    expect(proposed.versions[0]).toMatchObject({ versionNo: 2, status: 'proposed', current: false });
    expect((await get('/ledger/rules')).find((r: Rec) => r.key === 'F01').pending).toBe(true);
    await post(owner, `/ledger/rules/${f01.id}/versions`, { template, effectiveFrom: today, reason: 'ซ้ำ' }, 409);
    const version = proposed.versions[0].id;
    await post(owner, `/ledger/rules/${f01.id}/versions/${version}/actions/approve`, {}, 403); // never one's own
    await post(auditor, `/ledger/rules/${f01.id}/versions/${version}/actions/approve`, {}, 403);
    await post(owner, `/ledger/rules/${f01.id}/versions/${version}/actions/withdraw`);
    const again = await post(owner, `/ledger/rules/${f01.id}/versions`, { template: { ...template, description: 'รับสินค้า {documentNo}' }, effectiveFrom: today, reason: 'ย่อคำอธิบาย' }, 201);
    expect(again.versions[0].versionNo).toBe(3);
  });

  it('lists what waits for each person across the ERP (D-399)', async () => {
    const mine = await get('/inbox');
    expect(mine).toMatchObject({ asOf: today, counts: { approve: expect.any(Number), overdue: expect.any(Number), today: expect.any(Number), soon: expect.any(Number) } });
    for (const item of mine.items as Rec[]) expect(['approve', 'overdue', 'today', 'soon']).toContain(item.section);
    const theirs = await get('/inbox', operator);
    expect((theirs.items as Rec[]).every((i) => !['journal', 'period_to_close', 'receivable_overdue'].includes(i.kind))).toBe(true);
  });

  it('keeps the books private and read-only for the auditor (D-317, D-396)', async () => {
    expect((await get('/ledger/journals', auditor)).data.length).toBeGreaterThan(0);
    await get(`/ledger/reports/trial-balance?from=${month}-01&to=${today}`, auditor);
    await post(auditor, '/ledger/journals', { documentDate: today, description: 'x', lines: [{ accountCode: '6150', side: 'debit', amount: '1.00' }, { accountCode: '2140', side: 'credit', amount: '1.00' }] }, 403);
    await get('/ledger/settings', operator, 403);
    const staff = await staffToken(ctx, 'partner_manager');
    await get('/ledger/settings', staff, 403);
    await get(`/ledger/journals/${randomUUID()}`, owner, 404);
  });
});
