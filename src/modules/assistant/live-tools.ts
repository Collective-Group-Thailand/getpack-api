import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { AdvisoryLoadDto } from '@modules/advisory/advisory.dto';
import { AdvisoryService } from '@modules/advisory/advisory.service';
import { SupportHandoffDto } from '@modules/conversations/support.dto';
import { SupportService } from '@modules/conversations/support.service';
import { estimatedDeliveryDate } from '@modules/orders/order-views';
import { PriceHintsService } from '@modules/pricing/hints/price-hints.service';
import { StyleListQuery } from '@modules/styles/styles-store.dto';
import { StylesStoreService } from '@modules/styles/styles-store.service';
import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { HelpSearchService } from './help-search.service';
import { type ToolExecutor, type ToolName, type ToolOutcome } from './tools';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * D-304 the tools on live data, always as the signed-in customer: published styles, the advisor (flag
 * `advisory.enabled`), price hints (D-220, no factory identity D-050), the customer's own orders only, published
 * glossary terms, the help index, a D-221 hand-off. A domain refusal becomes `ok: false` for the model to relay.
 */
@Injectable()
export class LiveToolsFactory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly styles: StylesStoreService,
    private readonly advisory: AdvisoryService,
    private readonly hints: PriceHintsService,
    private readonly support: SupportService,
    private readonly help: HelpSearchService,
  ) {}

  for(actor: UserActor, sessionId: string): ToolExecutor {
    return { run: (name, input) => this.run(actor, sessionId, name, input) };
  }

  private async run(
    actor: UserActor,
    sessionId: string,
    name: ToolName,
    input: Record<string, unknown>,
  ): Promise<ToolOutcome> {
    try {
      switch (name) {
        case 'search_styles': {
          const query = Object.assign(new StyleListQuery(), { q: str(input['query']), limit: 5 });
          const list = await this.styles.list(query, actor.userId);
          return {
            ok: true,
            data: {
              styles: list.data.slice(0, 5).map((s) => ({
                code: s.code,
                nameTh: s.nameTh,
                nameEn: s.nameEn,
                startingPrice: s.startingPrice,
              })),
            },
          };
        }
        case 'recommend_structure': {
          // The same checks as the store endpoint's body (class-validator DTO).
          const load = plainToInstance(AdvisoryLoadDto, input['load'] ?? {});
          const errors = await validate(load, { whitelist: true, forbidNonWhitelisted: true });
          if (errors.length) return { ok: false, data: { invalid: errors.map((e) => e.property) } };
          const row = await this.advisory.recommend({ kind: 'customer', userId: actor.userId }, 'web', {
            productTypeCode: str(input['productTypeCode']),
            configuration: (input['configuration'] ?? {}) as Record<string, unknown>,
            load,
          });
          const view = await this.advisory.storeView(row);
          return { ok: true, data: { recommendation: view } };
        }
        case 'get_quote': {
          const slug = str(input['productSlug']);
          const hints = await this.hints.list({
            ...(slug && { slugs: [slug] }),
            ...(str(input['productTypeCode']) && { productType: str(input['productTypeCode']) }),
          });
          return {
            ok: hints.length > 0,
            data: hints.length
              ? {
                  hints: hints.slice(0, 5).map((h) => ({
                    key: h.key,
                    productTypeCode: h.productTypeCode,
                    startingFromPerPiece: h.startingFromPerPiece,
                    currency: h.currency,
                    basis: h.basis,
                    leadTimeBusinessDays: h.leadTimeBusinessDays,
                  })),
                }
              : { notFound: 'no starting price for that product; the configurator gives an exact price' },
          };
        }
        case 'get_order_status': {
          const order = await this.prisma.order.findFirst({
            where: { orderCode: str(input['orderCode']).trim().toUpperCase(), customerUserId: actor.userId },
            include: { quoteOption: { select: { earliestShipDate: true, result: true } } },
          });
          // Another customer's order is "not found" — never confirms it exists (D-304).
          if (!order) return { ok: false, data: { notFound: 'no order with that code in this account' } };
          return {
            ok: true,
            data: {
              orderCode: order.orderCode,
              status: order.status,
              artworkStatus: order.artworkStatus,
              promisedShipDate: order.promisedShipDate?.toISOString().slice(0, 10) ?? null,
              estimatedDeliveryDate: estimatedDeliveryDate(order.promisedShipDate, order.quoteOption),
              deliveredAt: order.deliveredAt?.toISOString().slice(0, 10) ?? null,
            },
          };
        }
        case 'lookup_glossary': {
          const term = str(input['term']).trim();
          const rows = await this.prisma.glossaryTerm.findMany({
            where: {
              status: 'published',
              deletedAt: null,
              OR: [
                { termTh: { contains: term, mode: 'insensitive' } },
                { termEn: { contains: term, mode: 'insensitive' } },
                { aliases: { has: term } },
              ],
            },
            orderBy: [{ sort: 'asc' }, { id: 'asc' }],
            take: 3,
          });
          return {
            ok: rows.length > 0,
            data: rows.length
              ? { terms: rows.map((r) => ({ term: r.termTh, termEn: r.termEn, definition: r.definitionTh })) }
              : { notFound: 'no glossary term' },
          };
        }
        case 'search_help': {
          const passages = await this.help.search(str(input['query']), 3);
          return {
            ok: passages.length > 0,
            data: passages.length ? { passages } : { notFound: 'no help passage' },
          };
        }
        case 'create_handoff': {
          const ticket = await this.support.handoff(
            actor,
            Object.assign(new SupportHandoffDto(), {
              page: 'assistant',
              answers: { assistantSessionId: sessionId },
              note: str(input['note']) || undefined,
            }),
          );
          return { ok: true, data: { ticketNo: ticket.ticketNo, respondBy: ticket.respondBy } };
        }
      }
    } catch (error) {
      if (error instanceof DomainException) return { ok: false, data: { refused: error.code } };
      throw error;
    }
  }
}
