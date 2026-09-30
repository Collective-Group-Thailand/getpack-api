/**
 * A promotion benefit (v1 schema, D-053) in words, Thai and English, so screens never re-derive it. Amounts are the
 * stored decimal strings (THB); nothing is computed.
 */
export function benefitSummary(benefit: unknown): { th: string; en: string } {
  const b = (benefit ?? {}) as Record<string, unknown>;
  const cap = typeof b['maxAmount'] === 'string' ? b['maxAmount'] : null;
  const capTh = cap ? ` สูงสุด ${cap} บาท` : '';
  const capEn = cap ? `, up to THB ${cap}` : '';
  switch (b['type']) {
    case 'percent':
      return { th: `ลด ${String(b['pct'])}%${capTh}`, en: `${String(b['pct'])}% off${capEn}` };
    case 'fixed':
      return { th: `ลด ${String(b['amount'])} บาท`, en: `THB ${String(b['amount'])} off` };
    case 'tiered': {
      const tiers = (b['tiers'] as { min: string; pct?: string; amount?: string }[] | undefined) ?? [];
      const byQty = b['basis'] === 'quantity';
      const th = tiers
        .map(
          (t) =>
            `${byQty ? `${t.min} ชิ้นขึ้นไป` : `${t.min} บาทขึ้นไป`} ลด ${t.pct ? `${t.pct}%` : `${t.amount} บาท`}`,
        )
        .join(', ');
      const en = tiers
        .map(
          (t) =>
            `${byQty ? `${t.min}+ pieces` : `THB ${t.min}+`}: ${t.pct ? `${t.pct}% off` : `THB ${t.amount} off`}`,
        )
        .join('; ');
      return { th: th + capTh, en: en + capEn };
    }
    case 'unit_price_override':
      return {
        th: `ราคาพิเศษ ${String(b['unitPrice'])} บาท/ชิ้น`,
        en: `Special price THB ${String(b['unitPrice'])} per piece`,
      };
    case 'free_revision_rounds':
      return {
        th: `แก้แบบฟรี ${String(b['rounds'])} รอบ`,
        en: `${String(b['rounds'])} free revision rounds`,
      };
    case 'points_multiplier':
      return { th: `คะแนน x${String(b['multiplier'])}`, en: `${String(b['multiplier'])}× points` };
    case 'bonus_points':
      return { th: `รับคะแนนพิเศษ ${String(b['points'])} คะแนน`, en: `${String(b['points'])} bonus points` };
    case 'free_shipping':
      return { th: 'ส่งฟรี', en: 'Free shipping' };
    case 'free_design':
      return { th: 'ออกแบบฟรี', en: 'Free design' };
    case 'free_mockup':
      return { th: 'ตัวอย่างฟรี', en: 'Free mock-up' };
    default:
      return { th: '—', en: '—' };
  }
}
