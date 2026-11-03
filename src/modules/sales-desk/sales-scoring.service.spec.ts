import { Prisma } from '@generated/prisma/client';

import { SCORING_RULES_SEED } from '../../../prisma/seed/data/settings';
import { SalesScoringService } from './sales-scoring.service';

/** D-471 item 2: what the score reads of an inbound item, and that storing it is a derived write. */
describe('SalesScoringService (D-471)', () => {
  const now = new Date('2026-11-10T03:00:00Z');
  const updatedAt = new Date('2026-11-01T00:00:00Z');

  function setup(row: Record<string, unknown>, company: unknown = null, cartItem: unknown = null) {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      salesInboundLead: {
        findUniqueOrThrow: jest.fn((args: { select: Record<string, unknown> }) =>
          Promise.resolve(
            'updatedAt' in args.select && Object.keys(args.select).length === 1 ? { updatedAt } : row,
          ),
        ),
        update,
      },
      companyMember: { findFirst: jest.fn().mockResolvedValue(company) },
      cartItem: { findFirst: jest.fn().mockResolvedValue(cartItem) },
    };
    const settings = { at: jest.fn().mockResolvedValue({ value: SCORING_RULES_SEED, versionId: 91n }) };
    return { service: new SalesScoringService({} as never, settings as never), tx, update };
  }

  const base = {
    source: 'rfq',
    contactEmail: 'buyer@bakery.co.th',
    captureUserId: null,
    designDocumentId: null,
    signalCount: 1,
    lastSignalAt: now,
    createdAt: now,
    rfq: null,
    supportTicket: null,
    agentLead: null,
  };

  it('reads an RFQ’s largest tier and target price × tier as the value, and the company’s tax id', async () => {
    const { service, tx } = setup(
      {
        ...base,
        rfq: {
          customerUserId: 4n,
          targetPricePerUnit: new Prisma.Decimal('12.50'),
          tiers: [{ quantity: 1000 }, { quantity: 10000 }],
        },
      },
      { company: { taxId: '0105561000001' } },
    );
    const input = await service.inboundInput(tx as never, 1n, now);
    expect(input).toMatchObject({
      kind: 'inbound',
      source: 'rfq',
      quantity: 10000,
      estimatedValue: '125000.00',
      taxIdPresent: true,
    });
  });

  it('reads the contact form quantity and a studio design’s cart line', async () => {
    const ticket = setup({
      ...base,
      source: 'contact_form',
      supportTicket: { customerUserId: null, context: { details: { quantity: 5000 } } },
    });
    expect((await ticket.service.inboundInput(ticket.tx as never, 1n, now)).quantity).toBe(5000);
    const studio = setup({ ...base, source: 'studio_idle', designDocumentId: 3n }, null, {
      quantity: 2000,
      unitPrice: new Prisma.Decimal('4.255000'),
    });
    expect(await studio.service.inboundInput(studio.tx as never, 1n, now)).toMatchObject({
      quantity: 2000,
      estimatedValue: '8510.00',
    });
  });

  it('stores the score with the rules version and leaves the item’s updated time alone', async () => {
    const { service, tx, update } = setup(base);
    const result = await service.scoreInbound(tx as never, 1n, now);
    expect(result.score).toBeGreaterThan(0);
    expect(update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({
        updatedAt,
        score: result.score,
        scoreReasons: result.reasons,
        scoredAt: now,
        scoreSettingVersionId: 91n,
      }),
    });
  });
});
