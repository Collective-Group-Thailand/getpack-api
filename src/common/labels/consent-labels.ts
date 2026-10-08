/**
 * Consent purposes in words (UX round 2 Phase 4 §A6 B8): the seeded purpose keys (D-144) are a closed set; their
 * names are product words, not legal text (the texts stay versions entered by legal counsel).
 */
const CONSENT_LABELS: Record<string, { th: string; en: string }> = {
  terms_of_service: { th: 'ข้อตกลงการใช้บริการ', en: 'Terms of service' },
  privacy_notice: { th: 'ประกาศความเป็นส่วนตัว', en: 'Privacy notice' },
  marketing_email: { th: 'รับข่าวสารและโปรโมชันทางอีเมล', en: 'News and offers by e-mail' },
  marketing_line: { th: 'รับข่าวสารและโปรโมชันทาง LINE', en: 'News and offers on LINE' },
  marketing_sms: { th: 'รับข่าวสารและโปรโมชันทาง SMS', en: 'News and offers by SMS' },
  analytics_cookies: { th: 'คุกกี้เพื่อการวิเคราะห์', en: 'Analytics cookies' },
  personalisation: { th: 'แนะนำสินค้าและเนื้อหาที่ตรงกับคุณ', en: 'Personalised recommendations' },
};

export const LABELLED_CONSENT_PURPOSES = Object.keys(CONSENT_LABELS);

/** `labelTh` / `labelEn` of a purpose; a purpose added later reads as its key in words until it gets a name. */
export function consentLabels(purpose: string): { labelTh: string; labelEn: string } {
  const l = CONSENT_LABELS[purpose];
  if (l) return { labelTh: l.th, labelEn: l.en };
  const words = purpose.replace(/_/g, ' ');
  return { labelTh: words, labelEn: words.charAt(0).toUpperCase() + words.slice(1) };
}
