import { randomUUID } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { bangkokDate, startOfBangkokMonth } from '@common/time/bangkok';
import { AgentCommissionsService } from '@modules/agents/agent-commissions.service';
import { AgentStatementsService } from '@modules/agents/agent-statements.service';
import { OrdersService } from '@modules/orders/orders.service';
import { PaymentSchedulesService } from '@modules/payment-schedules/payment-schedules.service';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  staffToken,
  uploadFile,
} from '../support/commerce-e2e';
import { activeVendorAccount, companyAccount, payVendors } from '../support/finance-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

type Page<T> = { data: T[] };
type Plan = { versions: { id: string; status: string }[] };

/**
 * The sales agent programme (D-416 – D-423): application and approval, link and lead attribution,
 * commission on completed orders, statements paid as vendor bills with ภ.ง.ด.1 withholding, employee
 * agents through payroll, maker-checked plans.
 */
describe('sales agents (e2e, D-416 – D-423)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let postcode: string;
  let sales: string;
  let financeManager: string;
  let finance: string;
  let chief: string;
  let plans: { id: string; code: string; agentKind: string }[];
  /** The customer linked through the code (second test), reused for the order. */
  let buyer: { token: string; phone: string };
  /** The employee agent's customer account (leads test), reused for payroll. */
  let employeeAccount: { token: string; phone: string };
  /** The freelance agent approved in the first test. */
  let agent: { token: string; phone: string; id: string; code: string; vendorId: string };

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    [sales, financeManager, finance, chief] = await Promise.all([
      staffToken(ctx, 'sales_manager'),
      staffToken(ctx, 'finance_manager'),
      staffToken(ctx, 'finance'),
      staffToken(ctx, 'c_level'),
    ]);
    plans = (await as(ctx, sales).get('/v1/admin/agent-plans').expect(200)).body;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const planId = (code: string) => plans.find((p) => p.code === code)!.id;

  /** Pays every instalment of the group (a succeeded slip payment applied to the schedule). */
  async function payAll(groupPublicId: string) {
    await ctx.prisma.withTx(async (tx) => {
      const group = await tx.orderGroup.findUniqueOrThrow({ where: { publicId: groupPublicId } });
      const cash = group.cashAmount.toFixed(2);
      const payment = await tx.payment.create({
        data: {
          entityId: group.entityId,
          orderGroupId: group.id,
          method: 'bank_transfer_slip',
          provider: 'slip',
          status: 'succeeded',
          referenceCode: `E2E${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`,
          amount: cash,
          cashAmount: cash,
          paidAt: new Date(),
        },
      });
      await ctx.app
        .get(PaymentSchedulesService)
        .applyPayment(tx, group.id, payment.id, cash, systemActor('e2e'));
    });
  }

  async function complete(orderPublicId: string) {
    const orders = ctx.app.get(OrdersService);
    await ctx.prisma.withTx(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { publicId: orderPublicId } });
      for (const fact of [
        { kind: 'artwork_approved' },
        { kind: 'production_started', mode: 'auto' },
        { kind: 'shipped' },
        { kind: 'delivered' },
        { kind: 'completed', mode: 'customer_confirmed' },
      ] as const)
        await orders.applyFact(tx, order.id, fact, systemActor('e2e'));
    });
  }

  /** Earned entries of an agent moved into last month, so last month's statement can be made. */
  async function earnLastMonth(agentPublicId: string) {
    const a = await ctx.prisma.salesAgent.findUniqueOrThrow({ where: { publicId: agentPublicId } });
    await ctx.prisma.salesAgentCommission.updateMany({
      where: { agentId: a.id, status: 'pending' },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    await ctx.app.get(AgentCommissionsService).earnDue();
    const lastMonth = new Date(startOfBangkokMonth(new Date()).getTime() - 5 * 86_400_000);
    await ctx.prisma.salesAgentCommission.updateMany({
      where: { agentId: a.id, status: 'earned', statementId: null },
      data: { earnedAt: lastMonth },
    });
    return ctx.app.get(AgentStatementsService).previousPeriod();
  }

  it('a customer applies with the agreement; Sales approves: agent, vendor, bank proposal, agent pages', async () => {
    const { token, phone } = await customerToken(ctx, 1);
    const programme = await as(ctx, token).get('/v1/store/agent/programme').expect(200);
    expect(programme.body).toMatchObject({
      state: 'none',
      agreement: { key: 'sales_agent_agreement', versionNo: 1 },
      plan: { firstOrderPct: '5', repeatOrderPct: '3', attributionMonths: 12 },
    });
    await as(ctx, token).get('/v1/store/agent').expect(403);

    const idDocument = await uploadFile(ctx, token, 'id card (fake)', 'evidence');
    const body = {
      juristicType: 'individual',
      legalName: '[E2E] ตัวแทน ขายดี (fake)',
      taxId: `1${String(ctx.run).padStart(12, '0').slice(-12)}`,
      address: '99/1 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ (fake)',
      postcode: '10310',
      idDocumentFileId: idDocument,
      bankCode: '014',
      bankAccountName: '[E2E] ตัวแทน ขายดี (fake)',
      bankAccountNo: '123-4-56789-0',
      agreementVersionNo: 1,
    };
    await as(ctx, token)
      .post('/v1/store/agent/application', { ...body, agreementVersionNo: 9 })
      .expect(409);
    const applied = await as(ctx, token).post('/v1/store/agent/application', body).expect(201);
    expect(applied.body).toMatchObject({
      status: 'submitted',
      bankAccountNoLast4: '7890',
      agreementVersionNo: 1,
    });
    expect(JSON.stringify(applied.body)).not.toContain('1234567890');
    const again = await as(ctx, token).post('/v1/store/agent/application', body).expect(409);
    expect(again.body.code).toBe('agents.application_open');

    const queue = await as(ctx, sales).get('/v1/admin/agent-applications?status=submitted').expect(200);
    expect((queue.body as Page<{ id: string }>).data.map((a) => a.id)).toContain(applied.body.id);
    // Marketing has no say in it (D-423).
    const marketing = await staffToken(ctx, 'marketing');
    await as(ctx, marketing)
      .post(`/v1/admin/agent-applications/${applied.body.id}/actions/approve`, {
        planId: planId('freelance_standard'),
      })
      .expect(403);
    await as(ctx, sales)
      .post(`/v1/admin/agent-applications/${applied.body.id}/actions/approve`, {
        planId: planId('employee_standard'),
      })
      .expect(422);
    const approved = await as(ctx, sales)
      .post(`/v1/admin/agent-applications/${applied.body.id}/actions/approve`, {
        planId: planId('freelance_standard'),
      })
      .expect(200);
    expect(approved.body).toMatchObject({
      kind: 'freelance',
      status: 'active',
      juristicType: 'individual',
      bankAccount: 'pending_approval',
      plan: { code: 'freelance_standard' },
    });
    const vendor = await ctx.prisma.vendor.findUniqueOrThrow({ where: { publicId: approved.body.vendorId } });
    expect(vendor).toMatchObject({
      kind: 'sales_agent',
      defaultWhtCategory: 'commission',
      paymentTermsDays: 15,
    });
    const proposal = await ctx.prisma.vendorBankAccount.findFirstOrThrow({ where: { vendorId: vendor.id } });
    expect(proposal).toMatchObject({ status: 'pending_approval', accountNoLast4: '7890' });

    const me = await as(ctx, token).get('/v1/store/agent').expect(200);
    expect(me.body).toMatchObject({
      code: approved.body.code,
      link: expect.stringContaining(`/a/${approved.body.code}`),
    });
    // D-435: an agent's totals never count factories (staff keep the count).
    expect(me.body.totals).not.toHaveProperty('factories');
    expect((await as(ctx, token).get('/v1/store/agent/programme').expect(200)).body.state).toBe('agent');
    agent = {
      token,
      phone,
      id: approved.body.id,
      code: approved.body.code,
      vendorId: approved.body.vendorId,
    };
  });

  it('links a new customer through the code — never the agent itself, never twice', async () => {
    expect(
      (await as(ctx, agent.token).post('/v1/store/agent/claims', { code: agent.code }).expect(200)).body,
    ).toEqual({
      linked: false,
      reason: 'own_code',
    });
    buyer = await customerToken(ctx, 2);
    await as(ctx, buyer.token).post('/v1/store/agent/claims', { code: 'NOPE2345' }).expect(422);
    expect(
      (
        await as(ctx, buyer.token)
          .post('/v1/store/agent/claims', { code: agent.code.toLowerCase() })
          .expect(200)
      ).body,
    ).toEqual({ linked: true, reason: null });
    expect(
      (await as(ctx, buyer.token).post('/v1/store/agent/claims', { code: agent.code }).expect(200)).body,
    ).toEqual({
      linked: false,
      reason: 'already_linked',
    });
    const mine = await as(ctx, agent.token).get('/v1/store/agent/customers').expect(200);
    expect(mine.body.data).toHaveLength(1);
    // D-422: a person who came through the link shows by first letter only.
    expect(mine.body.data[0]).toMatchObject({
      source: 'link',
      subject: 'customer',
      name: expect.stringMatching(/•••$/),
    });
  });

  it('commission on completion → earned → statement → bill → payout with ภ.ง.ด.1 withholding and its 50 ทวิ', async () => {
    const placed = await placeOrder(ctx, buyer.token, fixture, postcode);
    await payAll(placed.id);
    await complete(placed.orders[0]!.id);
    await ctx.pump();

    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: placed.orders[0]!.id } });
    const base = await ctx.app.get(AgentCommissionsService).base(ctx.prisma, order.id);
    const entries = await as(ctx, agent.token).get('/v1/store/agent/commissions').expect(200);
    expect(entries.body.data).toHaveLength(1);
    const entry = entries.body.data[0];
    expect(entry).toMatchObject({
      kind: 'order',
      status: 'pending',
      isFirstOrder: true,
      ratePct: '5',
      baseAmount: base.toFixed(2),
      orderCode: placed.orders[0]!.orderCode,
    });
    const byRate = base.mul(5).div(100).toDecimalPlaces(2);
    const expected =
      entry.capAmount !== null && Number(entry.capAmount) < byRate.toNumber()
        ? entry.capAmount
        : byRate.toFixed(2);
    expect(entry.amount).toBe(expected);

    // A month later: earned, statemented, approved by Finance.
    const period = await earnLastMonth(agent.id);
    await as(ctx, financeManager)
      .post('/v1/admin/agent-statements/actions/generate', { period: bangkokDate(new Date()).slice(0, 7) })
      .expect(422);
    const generated = await as(ctx, financeManager)
      .post('/v1/admin/agent-statements/actions/generate', { period })
      .expect(200);
    expect(generated.body.created).toBeGreaterThanOrEqual(1);
    const list = await as(ctx, financeManager)
      .get(`/v1/admin/agent-statements?agentId=${agent.id}`)
      .expect(200);
    const statement = list.body.data[0];
    expect(statement).toMatchObject({ status: 'draft', totalAmount: expected, entryCount: 1 });
    const detail = await as(ctx, financeManager)
      .get(`/v1/admin/agent-statements/${statement.id}`)
      .expect(200);
    await as(ctx, sales)
      .post(`/v1/admin/agent-statements/${statement.id}/actions/approve`)
      .set('If-Match', detail.headers['etag'] as string)
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    const approved = await as(ctx, financeManager)
      .post(`/v1/admin/agent-statements/${statement.id}/actions/approve`)
      .set('If-Match', detail.headers['etag'] as string)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', vendorInvoiceId: expect.any(String) });
    const payable = await ctx.prisma.payableItem.findFirstOrThrow({
      where: { vendorInvoice: { publicId: approved.body.vendorInvoiceId } },
    });
    expect(payable.whtBaseCommission.toFixed(2)).toBe(expected);
    await ctx.pump();
    expect(
      await ctx.prisma.journalLine.count({
        where: { account: { code: '6160' }, journalEntry: { sourceDocumentNo: statement.statementNo } },
      }),
    ).toBeGreaterThan(0);

    // Paid by a payout run; 3 % withheld on ภ.ง.ด.1 (D-421).
    const vendor = await ctx.prisma.vendor.findUniqueOrThrow({ where: { publicId: agent.vendorId } });
    await ctx.prisma.payableItem.update({
      where: { id: payable.id },
      data: { eligibleAt: new Date(Date.now() - 86_400_000) },
    });
    await activeVendorAccount(ctx, vendor.id, `88${String(ctx.run).padStart(8, '0')}`);
    const run = await payVendors(ctx, { finance, chief }, (await companyAccount(ctx)).id, [agent.vendorId]);
    const item = run.items[0]!;
    expect(item.whtAmount).toBe((Number(expected) * 0.03).toFixed(2));
    const certificate = await ctx.prisma.whtCertificate.findFirstOrThrow({ where: { vendorId: vendor.id } });
    expect(certificate).toMatchObject({ form: 'pnd1', incomeTypeCode: 'commission' });
    const mine = await as(ctx, agent.token).get(`/v1/store/agent/statements/${statement.id}`).expect(200);
    expect(mine.body).toMatchObject({ status: 'paid', whtAmount: item.whtAmount, hasWhtCertificate: true });
    expect(mine.body.entries).toHaveLength(1);
    await as(ctx, agent.token).get(`/v1/store/agent/statements/${statement.id}/wht-certificate`).expect(200);
    expect(
      await ctx.prisma.journalLine.count({ where: { account: { code: '2233' }, taxCode: 'wht_pnd1' } }),
    ).toBeGreaterThan(0);
  });

  it('leads: protected for one agent, refused for existing customers, converted on sign-up', async () => {
    const other = await customerToken(ctx, 3);
    employeeAccount = other;
    const employee = (
      await as(ctx, sales)
        .post('/v1/admin/agents', {
          customerId: (await ctx.prisma.user.findFirstOrThrow({ where: { phone: other.phone } })).publicId,
          legalName: '[E2E] พนักงานขาย (fake)',
          employeeCode: `E2E-${ctx.run}`,
          planId: planId('employee_standard'),
        })
        .expect(201)
    ).body;
    expect(employee).toMatchObject({ kind: 'employee', vendorId: null, bankAccount: 'none' });

    const leadPhone = `+668${String(ctx.run * 10 + 7)
      .padStart(8, '0')
      .slice(-8)}`;
    const lead = await as(ctx, agent.token)
      .post('/v1/store/agent/leads', {
        kind: 'customer',
        contactName: 'คุณผู้มุ่งหวัง (fake)',
        phone: leadPhone,
        consentConfirmed: true,
      })
      .expect(201);
    expect(lead.body).toMatchObject({ status: 'registered' });
    const taken = await as(ctx, other.token)
      .post('/v1/store/agent/leads', {
        kind: 'customer',
        contactName: 'ซ้ำ (fake)',
        phone: leadPhone,
        consentConfirmed: true,
      })
      .expect(409);
    expect(taken.body.code).toBe('agents.lead_taken');
    const existing = await as(ctx, agent.token)
      .post('/v1/store/agent/leads', {
        kind: 'customer',
        contactName: 'ลูกค้าเดิม',
        phone: other.phone,
        consentConfirmed: true,
      })
      .expect(409);
    expect(existing.body.code).toBe('agents.lead_existing_customer');
    // D-440: a factory already in getpack gets one neutral refusal that names no reason.
    const known = await ctx.prisma.factory.findFirstOrThrow();
    const factoryLead = await as(ctx, agent.token)
      .post('/v1/store/agent/leads', {
        kind: 'factory',
        contactName: 'ผู้ติดต่อ (fake)',
        taxId: known.taxId,
        consentConfirmed: true,
      })
      .expect(409);
    expect(factoryLead.body.code).toBe('agents.lead_unavailable');
    expect(`${factoryLead.body.title} ${factoryLead.body.detail}`).not.toMatch(/โรงงาน|factory/i);
    await as(ctx, agent.token)
      .post('/v1/store/agent/leads', {
        kind: 'customer',
        contactName: 'ไม่ยินยอม',
        email: 'x@example.invalid',
        consentConfirmed: false,
      })
      .expect(422);

    // The lead signs up with that phone (customerToken n=7 makes it).
    const signedUp = await customerToken(ctx, 7);
    expect(signedUp.phone).toBe(leadPhone);
    await ctx.pump();
    const converted = await as(ctx, agent.token).get('/v1/store/agent/leads?status=converted').expect(200);
    expect((converted.body as Page<{ id: string }>).data.map((l) => l.id)).toContain(lead.body.id);
    const links = await as(ctx, sales).get(`/v1/admin/agent-links?agentId=${agent.id}`).expect(200);
    expect(links.body.data).toContainEqual(expect.objectContaining({ source: 'lead', status: 'active' }));
    // A lead the agent registered shows by name (D-422).
    const mine = await as(ctx, agent.token).get('/v1/store/agent/customers').expect(200);
    expect(
      (mine.body as Page<{ source: string; name: string }>).data.some(
        (l) => l.source === 'lead' && !l.name.endsWith('•••'),
      ),
    ).toBe(true);
  });

  it('employee agents: adjustment, statement accrued (AG01), payroll export and paid', async () => {
    const other = employeeAccount;
    const me = (await as(ctx, other.token).get('/v1/store/agent').expect(200)).body;
    await as(ctx, sales)
      .post('/v1/admin/agent-commissions', { agentId: me.id, amount: '500.00', note: 'ทดสอบ (fake)' })
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    await as(ctx, financeManager)
      .post('/v1/admin/agent-commissions', {
        agentId: me.id,
        amount: '500.00',
        note: 'ค่าคอมงานพิเศษ (fake)',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const period = await earnLastMonth(me.id);
    await as(ctx, financeManager).post('/v1/admin/agent-statements/actions/generate', { period }).expect(200);
    const statement = (
      await as(ctx, financeManager).get(`/v1/admin/agent-statements?agentId=${me.id}`).expect(200)
    ).body.data[0];
    const detail = await as(ctx, financeManager)
      .get(`/v1/admin/agent-statements/${statement.id}`)
      .expect(200);
    await as(ctx, financeManager)
      .post(`/v1/admin/agent-statements/${statement.id}/actions/approve`)
      .set('If-Match', detail.headers['etag'] as string)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    await ctx.pump();
    const accrued = await ctx.prisma.journalLine.findMany({
      where: { journalEntry: { sourceDocumentNo: statement.statementNo } },
      include: { account: true },
    });
    expect(accrued.map((l) => l.account.code).sort()).toEqual(['2410', '6160']);
    const exported = await as(ctx, financeManager)
      .post('/v1/admin/agent-statements/actions/export-payroll', { period })
      .expect(200);
    expect(exported.body.statements).toBeGreaterThanOrEqual(1);
    await as(ctx, financeManager)
      .post(`/v1/admin/agent-statements/${statement.id}/actions/mark-paid`, {
        paidOn: bangkokDate(new Date()),
      })
      .expect(200);
    const paid = await as(ctx, other.token).get(`/v1/store/agent/statements/${statement.id}`).expect(200);
    expect(paid.body).toMatchObject({ status: 'paid', totalAmount: '500.00' });
  });

  it('plans: a version needs another approver (maker-checker)', async () => {
    const drafted = await as(ctx, sales)
      .post(`/v1/admin/agent-plans/${planId('employee_standard')}/versions`, {
        effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
        firstOrderPct: '2.5',
        repeatOrderPct: '1',
        attributionMonths: 12,
        marginCapPct: '20',
        minBaseAmount: '0.00',
        factoryBountyAmount: '1000.00',
        factoryQualifyJobs: 3,
        factoryQualifyDays: 120,
        reason: 'ทดสอบ (fake)',
      })
      .expect(201);
    const draft = (drafted.body as Plan).versions.find((v) => v.status === 'draft')!;
    await as(ctx, sales).post(`/v1/admin/agent-plans/versions/${draft.id}/actions/approve`).expect(403);
    const decided = await as(ctx, chief)
      .post(`/v1/admin/agent-plans/versions/${draft.id}/actions/approve`)
      .expect(200);
    expect((decided.body as Plan).versions.find((v) => v.id === draft.id)!.status).toBe('approved');
  });

  it('menu: Sales sees the agents desk', async () => {
    const me = await as(ctx, sales).get('/v1/admin/me').expect(200);
    expect((me.body as { menu: { key: string }[] }).menu.map((m) => m.key)).toContain('agents');
  });
});
