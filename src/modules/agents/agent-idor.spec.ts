import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { type SalesAgent } from '@generated/prisma/client';

import { AgentAttributionService } from './agent-attribution.service';
import { AgentDiscountsService } from './agent-discounts.service';
import { AgentLeadsService } from './agent-leads.service';
import { AgentQuotesService } from './agent-quotes.service';
import { StoreAgentController } from './agents.controller';

/**
 * P7 security review (docs/design/agent-portal/SECURITY-REVIEW-P7.md, IDOR): every agent-zone call that takes an id
 * answers 404 `http.not_found` for a row of ANOTHER agent — the same answer as an unknown id, so ids cannot be
 * enumerated — and never reads further (no timeline, no options, no writes).
 */

const ME = { id: 1n, publicId: 'agent-me', status: 'active', userId: 10n } as unknown as SalesAgent;
const OTHER_AGENT_ID = 2n;
const ACTOR: UserActor = { type: 'user', userId: 10n, publicId: 'user-me', audience: 'customer', scopes: [] };
const ID = '0192f3a0-7c1e-7d2a-9b1f-000000000001';

const notFound = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).code).toBe('http.not_found');
};

function prismaWith(tables: Record<string, Record<string, jest.Mock>>) {
  const prisma: Record<string, unknown> = { ...tables };
  prisma.withTx = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

const otherLead = { id: 50n, publicId: ID, agentId: OTHER_AGENT_ID, kind: 'customer', status: 'registered' };
const otherQuote = { id: 60n, publicId: ID, agentId: OTHER_AGENT_ID, status: 'sent', quote: { options: [] } };

function leadsService(prisma: unknown) {
  return new AgentLeadsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function quotesService(prisma: unknown) {
  return new AgentQuotesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('agent zone IDOR — another agent’s ids answer 404', () => {
  describe('leads (store.agentLeads.*)', () => {
    const activities = jest.fn();
    const prisma = prismaWith({
      salesAgentLead: { findUnique: jest.fn().mockResolvedValue(otherLead), update: jest.fn() },
      salesAgentLeadActivity: { findMany: activities, create: jest.fn() },
    });
    const leads = leadsService(prisma);

    it('get', () => notFound(leads.mine(ME, ID)));
    it('listActivities, without reading the timeline', async () => {
      await notFound(leads.activities(ME, ID, undefined, 20));
      expect(activities).not.toHaveBeenCalled();
    });
    it('update', () => notFound(leads.update(ACTOR, ME, ID, {}, '"x"')));
    it('changeStage', () => notFound(leads.changeStage(ACTOR, ME, ID, { stage: 'contacted' })));
    it('addActivity', () => notFound(leads.addActivity(ACTOR, ME, ID, { kind: 'note', body: 'x' })));
    it('a factory lead of mine is not a customer lead either', async () => {
      const own = prismaWith({
        salesAgentLead: {
          findUnique: jest.fn().mockResolvedValue({ ...otherLead, agentId: ME.id, kind: 'factory' }),
        },
      });
      await notFound(leadsService(own).mine(ME, ID));
    });
    it('an unknown id answers the same', async () => {
      const none = prismaWith({ salesAgentLead: { findUnique: jest.fn().mockResolvedValue(null) } });
      await notFound(leadsService(none).mine(ME, ID));
    });
  });

  describe('lead withdraw (store.agent.withdrawLead)', () => {
    it('refuses another agent’s lead', async () => {
      const update = jest.fn();
      const prisma = prismaWith({
        salesAgentLead: { findUnique: jest.fn().mockResolvedValue(otherLead), update },
      });
      const attribution = new AgentAttributionService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await notFound(attribution.withdrawLead(ACTOR, ME, ID));
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('quotes and deals (store.agentQuotes.*)', () => {
    const prisma = prismaWith({ salesAgentQuote: { findUnique: jest.fn().mockResolvedValue(otherQuote) } });
    const quotes = quotesService(prisma);

    it('get', () => notFound(quotes.get(ME, ID)));
    it('resend', () => notFound(quotes.resend(ACTOR, ME, ID)));
    it('withdraw', () => notFound(quotes.withdraw(ACTOR, ME, ID)));
    it('registerDeal', () => notFound(quotes.registerDeal(ACTOR, ME, ID)));
  });

  describe('discount requests and options', () => {
    function discounts(prisma: unknown, quotes: AgentQuotesService) {
      return new AgentDiscountsService(
        prisma as never,
        {} as never,
        quotes,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    }

    it('discountRequests and requestDiscount on another agent’s quote', async () => {
      const prisma = prismaWith({ salesAgentQuote: { findUnique: jest.fn().mockResolvedValue(otherQuote) } });
      const service = discounts(prisma, quotesService(prisma));
      await notFound(service.requests(ME, ID));
      await notFound(service.request(ACTOR, ME, ID, {} as never));
    });

    it('acceptOption with an option of another quote, even on my own quote', async () => {
      const update = jest.fn();
      const prisma = prismaWith({
        salesAgentQuote: {
          findUnique: jest.fn().mockResolvedValue({ ...otherQuote, id: 61n, agentId: ME.id }),
        },
        salesAgentDiscountOption: {
          findUnique: jest.fn().mockResolvedValue({ id: 70n, request: { agentQuoteId: 60n } }),
          update,
        },
      });
      await notFound(discounts(prisma, quotesService(prisma)).acceptOption(ACTOR, ME, ID, ID));
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('statements and the 50 ทวิ (store.agent.statement / whtCertificate)', () => {
    const fake = {
      agents: { mine: jest.fn().mockResolvedValue(ME) },
      statements: {
        get: jest.fn().mockResolvedValue({ id: 80n, agentId: OTHER_AGENT_ID, status: 'approved' }),
        entries: jest.fn(),
        certificateUrl: jest.fn(),
      },
    };

    it('statement detail', async () => {
      await notFound(StoreAgentController.prototype.myStatement.call(fake as never, ACTOR, ID));
      expect(fake.statements.entries).not.toHaveBeenCalled();
    });

    it('50 ทวิ download', async () => {
      await notFound(StoreAgentController.prototype.certificate.call(fake as never, ACTOR, ID));
      expect(fake.statements.certificateUrl).not.toHaveBeenCalled();
    });

    it('a voided statement of mine is not shown either', async () => {
      const mine = {
        ...fake,
        statements: {
          ...fake.statements,
          get: jest.fn().mockResolvedValue({ id: 81n, agentId: ME.id, status: 'voided' }),
        },
      };
      await notFound(StoreAgentController.prototype.myStatement.call(mine as never, ACTOR, ID));
    });
  });
});
