import {
  type AssistantBlock,
  type AssistantMessage,
  type AssistantModel,
  type ModelReply,
  type ToolSpec,
} from './model.port';
import { type ToolName } from './tools';

const ORDER_CODE = /\b([A-Z]{2,8}-\d{4}-\d{4,6}(?:-\d{2})?)\b/i;

interface Intent {
  tool: ToolName;
  input: Record<string, unknown>;
}

/** The Thai intent of a message (deterministic keyword rules — the fake, not a quality claim; ADR-0012). */
export function intentOf(text: string): Intent | null {
  const t = text.toLowerCase();
  if (
    /(คุยกับ(พนักงาน|เจ้าหน้าที่|คน|แอดมิน)|ติดต่อ(เจ้าหน้าที่|พนักงาน|ทีม)|ขอคุยกับ|ส่งเรื่อง|human|agent)/.test(
      t,
    )
  )
    return { tool: 'create_handoff', input: { note: text.slice(0, 500) } };
  const code = ORDER_CODE.exec(text);
  // A policy question about orders ("ยกเลิกคำสั่งซื้อได้ไหม") is a help question when no order is named.
  if (!code && /(คืนเงิน|รับประกัน|เคลม|เปลี่ยนสินค้า|นโยบาย|เงื่อนไข|ยกเลิก|วิธี|ทำอย่างไร|ทำยังไง)/.test(t))
    return { tool: 'search_help', input: { query: text } };
  if (code || /(ออร์เดอร์|คำสั่งซื้อ|สถานะ|ของถึง|จัดส่งถึงไหน|order)/.test(t))
    return code ? { tool: 'get_order_status', input: { orderCode: code[1]!.toUpperCase() } } : null;
  if (/(แปลว่า|หมายถึง|คืออะไร|ความหมาย|meaning of|what is)/.test(t)) {
    const term = text
      .replace(
        /(แปลว่าอะไร|แปลว่า|หมายถึงอะไร|หมายถึง|คืออะไร|ความหมายของ|ความหมาย|meaning of|what is|\?|ครับ|ค่ะ|คะ)/gi,
        '',
      )
      .trim();
    return { tool: 'lookup_glossary', input: { term: term || text } };
  }
  if (
    /(คืนเงิน|รับประกัน|เคลม|เปลี่ยนสินค้า|นโยบาย|เงื่อนไข|ยกเลิก|วิธี|ทำอย่างไร|ทำยังไง|refund|policy|how to)/.test(
      t,
    )
  )
    return { tool: 'search_help', input: { query: text } };
  if (/(ราคา|เท่าไร|เท่าไหร่|กี่บาท|price|cost)/.test(t)) {
    const slug = /\b([a-z0-9]+(?:-[a-z0-9]+)+)\b/.exec(t)?.[1];
    return { tool: 'get_quote', input: slug ? { productSlug: slug } : {} };
  }
  if (/(กล่อง|แบบ|ทรง|ถุง|ซอง|ฉลาก|สติ๊กเกอร์|box|style)/.test(t))
    return { tool: 'search_styles', input: { query: text.slice(0, 100) } };
  return null;
}

type Data = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** The answer the fake writes from a tool result — only values the result carries (D-304). */
export function answerFrom(tool: string, ok: boolean, data: Data): string {
  if (!ok) {
    if (data['notFound'] && tool === 'get_order_status')
      return 'ไม่พบคำสั่งซื้อนี้ในบัญชีของคุณค่ะ ผู้ช่วยดูได้เฉพาะคำสั่งซื้อของคุณเท่านั้น';
    return 'ยังไม่พบข้อมูลที่ตรงกับคำถามค่ะ ต้องการให้ส่งเรื่องให้ทีมบริการลูกค้าไหมคะ';
  }
  switch (tool) {
    case 'search_styles': {
      const styles = (data['styles'] as { code: string; nameTh: string }[]) ?? [];
      if (!styles.length)
        return 'ยังไม่พบแบบกล่องที่ตรงกับคำค้นค่ะ ลองใช้คำอื่นหรือเปิดคลังแบบกล่องได้เลยค่ะ';
      return `แบบกล่องที่ตรงกับที่ค้นหา: ${styles.map((s) => `${s.nameTh} (${s.code})`).join(', ')}`;
    }
    case 'get_quote': {
      const hints =
        (data['hints'] as { startingFromPerPiece: string | null; basis: { quantity: number } | null }[]) ??
        [];
      const h = hints.find((x) => x.startingFromPerPiece);
      if (!h) return 'สินค้านี้ยังไม่มีราคาเริ่มต้นค่ะ ขอใบเสนอราคาได้จากหน้าสินค้าค่ะ';
      return `ราคาเริ่มต้น ${h.startingFromPerPiece} บาทต่อชิ้น${h.basis ? ` ที่จำนวน ${num(h.basis.quantity)} ชิ้น` : ''} ราคาจริงตามขนาดดูได้ในหน้าออกแบบค่ะ`;
    }
    case 'get_order_status': {
      const eta = data['estimatedDeliveryDate']
        ? ` คาดว่าจะได้รับประมาณ ${num(data['estimatedDeliveryDate'])}`
        : '';
      return `คำสั่งซื้อ ${num(data['orderCode'])} สถานะตอนนี้: ${num(data['status'])}${eta}`;
    }
    case 'lookup_glossary': {
      const terms = (data['terms'] as { term: string; definition: string }[]) ?? [];
      return terms.map((x) => `${x.term}: ${x.definition}`).join('\n');
    }
    case 'search_help': {
      const passages = (data['passages'] as { passage: string }[]) ?? [];
      return passages[0]?.passage ?? '';
    }
    case 'create_handoff':
      return `ส่งเรื่องให้ทีมบริการลูกค้าแล้วค่ะ เลขที่ ${num(data['ticketNo'])} ทีมงานจะติดต่อกลับค่ะ`;
    case 'recommend_structure':
      return 'ได้คำแนะนำโครงสร้างกล่องแล้วค่ะ ดูรายละเอียดวัสดุที่แนะนำได้ในหน้าผลการแนะนำค่ะ';
    default:
      return '';
  }
}

const words = (s: string) => Math.max(1, Math.ceil(s.length / 4));

/**
 * The deterministic fake model (ADR-0012: the only one until a vendor is accepted). One user message → at most one
 * tool call by keyword intent, then an answer written from that tool's result only. Usage is counted as characters / 4.
 */
export class FakeAssistantModel implements AssistantModel {
  readonly provider = 'fake';
  readonly model = 'fake-rules-1';

  complete(request: {
    system: string;
    messages: AssistantMessage[];
    tools: ToolSpec[];
  }): Promise<ModelReply> {
    const last = request.messages.at(-1)!;
    const inputTokens =
      words(request.system) + request.messages.reduce((n, m) => n + words(JSON.stringify(m)), 0);
    const reply = (content: AssistantBlock[], stopReason: ModelReply['stopReason']): Promise<ModelReply> =>
      Promise.resolve({
        content,
        stopReason,
        usage: { inputTokens, outputTokens: content.reduce((n, b) => n + words(JSON.stringify(b)), 0) },
      });
    if (last.role === 'tool_results') {
      const call = [...request.messages]
        .reverse()
        .find((m) => m.role === 'assistant')!
        .content.find((b) => b.type === 'tool_use') as Extract<AssistantBlock, { type: 'tool_use' }>;
      const result = last.results[0]!;
      const data = JSON.parse(result.content) as { ok: boolean; data: Data };
      return reply([{ type: 'text', text: answerFrom(call.name, data.ok, data.data) }], 'end_turn');
    }
    if (last.role !== 'user') return reply([{ type: 'text', text: '' }], 'end_turn');
    const intent = intentOf(last.content);
    if (!intent || !request.tools.some((t) => t.name === intent.tool))
      return reply(
        [
          {
            type: 'text',
            text: 'ผู้ช่วยช่วยค้นหาแบบกล่อง ดูราคาเริ่มต้น สถานะคำสั่งซื้อของคุณ คำศัพท์ และวิธีใช้งานได้ค่ะ หรือให้ส่งเรื่องถึงทีมบริการลูกค้าก็ได้ค่ะ',
          },
        ],
        'end_turn',
      );
    return reply([{ type: 'tool_use', id: 'call_1', name: intent.tool, input: intent.input }], 'tool_use');
  }
}
