/**
 * D-468 (PLAN A-13): reads `docs/design/agent-portal/PLAYBOOK.md` into playbook cards. Each card is a `## key ·
 * contexts: a, b · audience: x, y` heading, a bold title line, the body (markdown) and the "**ตอบลูกค้า…:**" replies
 * (bullets or one inline reply). Pure; the seed data is generated from it and a unit test keeps them in step.
 */

export const PLAYBOOK_CONTEXTS = [
  'lead_lost_price',
  'competitor_cheaper',
  'discount_request',
  'big_deal',
  'follow_up',
  'first_contact',
] as const;
export const PLAYBOOK_AUDIENCES = ['agent', 'rep', 'manager'] as const;

export interface PlaybookCardSeed {
  key: string;
  contexts: string[];
  audiences: (typeof PLAYBOOK_AUDIENCES)[number][];
  titleTh: string;
  bodyTh: string;
  suggestedReplies: { th: string; en: string | null }[];
  sort: number;
}

const HEADING = /^## ([a-z0-9-]+) · contexts: ([^·]+) · audience: (.+)$/;
const REPLY = /^\*\*ตอบลูกค้า[^*]*:\*\*\s*(.*)$/;

const unquote = (t: string) =>
  t
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .trim();

export function parsePlaybook(md: string): PlaybookCardSeed[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const cards: PlaybookCardSeed[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = HEADING.exec(lines[i]!);
    if (!m) {
      i += 1;
      continue;
    }
    const block: string[] = [];
    i += 1;
    while (i < lines.length && !HEADING.test(lines[i]!) && lines[i] !== '---') block.push(lines[i++]!);
    const titleIndex = block.findIndex((l) => /^\*\*.+\*\*$/.test(l.trim()));
    const titleTh = titleIndex >= 0 ? block[titleIndex]!.trim().slice(2, -2) : m[1]!;
    const rest = block.slice(titleIndex + 1);
    const replyAt = rest.findIndex((l) => REPLY.test(l.trim()));
    const bodyLines = replyAt >= 0 ? rest.slice(0, replyAt) : rest;
    const replies: string[] = [];
    if (replyAt >= 0) {
      const inline = REPLY.exec(rest[replyAt]!.trim())![1]!;
      if (inline) replies.push(unquote(inline));
      for (const l of rest.slice(replyAt + 1))
        if (/^- /.test(l.trim())) replies.push(unquote(l.trim().slice(2)));
    }
    const contexts = m[2]!.split(',').map((c) => c.trim());
    cards.push({
      key: m[1]!,
      contexts,
      audiences: m[3]!.split(',').map((a) => a.trim()) as PlaybookCardSeed['audiences'],
      titleTh,
      bodyTh: bodyLines.join('\n').trim(),
      suggestedReplies: replies.map((th) => ({ th, en: null })),
      sort: (cards.length + 1) * 10,
    });
  }
  return cards;
}
