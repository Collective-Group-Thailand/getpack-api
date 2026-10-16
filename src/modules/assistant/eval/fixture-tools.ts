import { type ToolExecutor, type ToolName, type ToolOutcome } from '../tools';
import { FIXTURE } from './cases';

/** Deterministic tool answers for the evaluation (fake data, no customer, no factory — D-050, D-306). */
export const fixtureTools: ToolExecutor = {
  run(name: ToolName, input: Record<string, unknown>): Promise<ToolOutcome> {
    const ok = (data: Record<string, unknown>) => Promise.resolve({ ok: true, data });
    switch (name) {
      case 'search_styles':
        return ok({
          styles: [
            { code: 'PK-TE-01', nameTh: 'กล่องฝาเสียบ', nameEn: 'Tuck end box', startingPrice: null },
            { code: 'PK-MB-01', nameTh: 'กล่องไปรษณีย์', nameEn: 'Mailer box', startingPrice: null },
          ],
        });
      case 'get_quote':
        return ok({
          hints: [
            {
              key: 'mailer-box',
              productTypeCode: 'corrugated',
              startingFromPerPiece: FIXTURE.startingPrice,
              currency: 'THB',
              basis: { quantity: 1000, includesVat: true, includesDelivery: false },
              leadTimeBusinessDays: { min: 7, max: 10 },
            },
          ],
        });
      case 'get_order_status':
        return String(input['orderCode']).toUpperCase() === FIXTURE.ownOrder
          ? ok({
              orderCode: FIXTURE.ownOrder,
              status: FIXTURE.orderStatus,
              artworkStatus: 'approved',
              promisedShipDate: '2026-11-10',
              estimatedDeliveryDate: '2026-11-12',
              deliveredAt: null,
            })
          : Promise.resolve({ ok: false, data: { notFound: 'no order with that code in this account' } });
      case 'lookup_glossary':
        return ok({
          terms: [
            { term: String(input['term']), termEn: null, definition: 'คำศัพท์บรรจุภัณฑ์ (ข้อมูลทดสอบ)' },
          ],
        });
      case 'search_help':
        return ok({
          passages: [
            {
              source: 'article:help-fake',
              title: 'ศูนย์ช่วยเหลือ (ทดสอบ)',
              passage:
                'รายละเอียดเงื่อนไขอยู่ในศูนย์ช่วยเหลือของ getpack หากมีข้อสงสัยทีมบริการลูกค้ายินดีช่วยค่ะ',
            },
          ],
        });
      case 'recommend_structure':
        return ok({ recommendation: { outcome: 'recommended' } });
      case 'create_handoff':
        return ok({ ticketNo: FIXTURE.ticketNo, respondBy: '2026-10-05T10:00:00+07:00' });
    }
  },
};
