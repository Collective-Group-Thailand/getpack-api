import { DomainException } from '@common/errors/domain.exception';

import { type CaptureRoute } from './capture-rules';
import { SalesInboundService } from './sales-inbound.service';

/**
 * D-471 item 3: the P4 sources (contact ticket routed to sales, RFQ of a non-customer) respect the attribution
 * precedence — an agent's contact never enters the company pool, a rep's goes to that rep, else the pool.
 */
describe('inbound sources respect attribution precedence (D-471)', () => {
  const ticket = {
    id: 11n,
    ticketNo: 'CS-2611-00042',
    topic: 'quote',
    customerUserId: 4n,
    contactName: 'คุณวิภา',
    contactPhone: '0890002222',
    contactEmail: 'Wipa@Example.invalid',
    context: { details: { company: 'ขนมดี', quantity: 5000 } },
    customer: null,
  };
  const rfq = {
    id: 12n,
    rfqCode: 'RFQ-2611-0001',
    customerUserId: 4n,
    customer: { id: 4n, displayName: 'คุณวิภา', phone: '+66890002222', email: 'wipa@example.invalid' },
  };

  function setup(route: CaptureRoute, orders = 0) {
    const tx = {
      supportTicket: { findUnique: jest.fn().mockResolvedValue(ticket) },
      rfq: { findUnique: jest.fn().mockResolvedValue(rfq) },
      salesInboundLead: { findUnique: jest.fn().mockResolvedValue(null) },
      orderGroup: { count: jest.fn().mockResolvedValue(orders) },
    };
    const routes = { route: jest.fn().mockResolvedValue(route) };
    const service = new SalesInboundService(
      {} as never,
      { value: jest.fn().mockResolvedValue('manual') } as never,
      {} as never,
      {} as never,
      { registerAssignees: jest.fn() } as never,
      {} as never,
      routes as never,
      {} as never,
      {} as never,
    );
    const row = { id: 70n, publicId: 'row' };
    const intake = jest.spyOn(service, 'intake').mockResolvedValue(row as never);
    const assign = jest.spyOn(service, 'assignInTx').mockResolvedValue(undefined);
    const auto = jest.spyOn(service, 'autoAssign').mockResolvedValue(undefined);
    return { service, tx, routes, intake, assign, auto, row };
  }

  const ticketEvent = { payload: { queue: 'sales', ticketNo: ticket.ticketNo } } as never;
  const rfqEvent = { aggregateId: 'rfq' } as never;

  it('keeps an agent’s contact out of the pool (contact ticket and RFQ)', async () => {
    const t = setup({ route: 'agent' });
    await t.service.onTicketOpened(ticketEvent, t.tx as never);
    await t.service.onRfqSubmitted(rfqEvent, t.tx as never);
    expect(t.intake).not.toHaveBeenCalled();
    // The contact is looked up by the signed-in customer and the normalised phone / e-mail.
    expect(t.routes.route).toHaveBeenCalledWith(t.tx, {
      userId: 4n,
      phone: '+66890002222',
      email: 'wipa@example.invalid',
    });
  });

  it('gives a rep’s contact to that rep (`attribution`) and records who the item came from', async () => {
    const t = setup({ route: 'rep', repUserId: 44n, via: 'agent_lead' });
    await t.service.onTicketOpened(ticketEvent, t.tx as never);
    expect(t.intake).toHaveBeenCalledWith(
      t.tx,
      'contact_form',
      ticket.ticketNo,
      expect.anything(),
      expect.objectContaining({ supportTicketId: 11n, captureUserId: 4n }),
    );
    expect(t.assign).toHaveBeenCalledWith(t.tx, t.row, 44n, 'attribution', null, expect.anything());
    expect(t.auto).not.toHaveBeenCalled();
  });

  it('puts everyone else in the pool by the assignment mode; RFQs of customers stay out', async () => {
    const t = setup({ route: 'pool' });
    await t.service.onRfqSubmitted(rfqEvent, t.tx as never);
    expect(t.intake).toHaveBeenCalledWith(
      t.tx,
      'rfq',
      rfq.rfqCode,
      expect.anything(),
      expect.objectContaining({ rfqId: 12n, captureUserId: 4n }),
    );
    expect(t.auto).toHaveBeenCalledWith(t.tx, t.row, expect.anything());
    const customer = setup({ route: 'pool' }, 1);
    await customer.service.onRfqSubmitted(rfqEvent, customer.tx as never);
    expect(customer.intake).not.toHaveBeenCalled();
  });

  it('falls back to the pool when the attributed rep has no active employee agent', async () => {
    const t = setup({ route: 'pool' });
    t.assign.mockRejectedValue(new DomainException('sales.rep_unavailable'));
    await t.service.placeByRoute(
      t.tx as never,
      t.row as never,
      { route: 'rep', repUserId: 44n, via: 'inbound' },
      {
        type: 'system',
      } as never,
    );
    expect(t.auto).toHaveBeenCalled();
  });

  it('refuses to place an agent-attributed contact at all', async () => {
    const t = setup({ route: 'pool' });
    await expect(
      t.service.placeByRoute(t.tx as never, t.row as never, { route: 'agent' }, { type: 'system' } as never),
    ).rejects.toThrow(/never enters the company pool/);
  });
});
