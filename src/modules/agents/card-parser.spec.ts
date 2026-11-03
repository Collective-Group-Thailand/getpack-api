import { FAKE_CARD_LINES } from '@integrations/ocr/fake-ocr';
import { linesFromTsv } from '@integrations/ocr/tesseract-cli-ocr';

import { parseCard, phonesIn, validThaiTaxId } from './card-parser';

const lines = (texts: string[], confidence = 90) => texts.map((text) => ({ text, confidence }));

describe('business card parser (D-468)', () => {
  it('reads a Thai card (obviously fake data)', () => {
    const card = parseCard(lines(FAKE_CARD_LINES));
    expect(card.contactName?.value).toBe('คุณมานี ใจดี');
    expect(card.organisationName?.value).toBe('บริษัท ตัวอย่างบรรจุภัณฑ์ จำกัด');
    expect(card.phone?.value).toBe('+66890001234');
    expect(card.email?.value).toBe('manee@example.invalid');
    expect(card.lineId?.value).toBe('manee.cafe');
    expect(card.taxId).toEqual({ value: '0000000000124', confidence: 0.9 });
    expect(card.contactName!.confidence).toBeGreaterThan(0.8);
  });

  it('reads an English card with office, mobile and fax numbers', () => {
    const card = parseCard(
      lines([
        'EXAMPLE PACKAGING CO., LTD.',
        'Mr. Test Example',
        'Purchasing Manager',
        '99/1 Rama 9 Road, Bangkok 10310',
        'Tel. 02-000-0000  Mobile +66 81 000 0000',
        'Fax 02-000-0001',
        'E-mail: Test.Example@Example.invalid',
        'www.example.invalid',
        'Line ID: @examplepack',
      ]),
    );
    expect(card.contactName?.value).toBe('Mr. Test Example');
    expect(card.organisationName?.value).toBe('EXAMPLE PACKAGING CO., LTD.');
    expect(card.phone?.value).toBe('+66810000000');
    expect(card.otherPhones.map((p) => p.value)).toEqual(['+6620000000']);
    expect(card.email?.value).toBe('test.example@example.invalid');
    expect(card.website?.value).toBe('www.example.invalid');
    expect(card.lineId?.value).toBe('@examplepack');
    expect(card.taxId).toBeNull();
  });

  it('guesses an untitled name with lower confidence and ignores a 13-digit number that is no tax id', () => {
    const card = parseCard(
      lines(['สมศรี ตัวอย่าง', 'ร้านขนมบ้านสวน', '0890005678', 'บัญชี 1234567890123'], 50),
    );
    expect(card.contactName).toEqual({ value: 'สมศรี ตัวอย่าง', confidence: 0.3 });
    expect(card.organisationName?.value).toBe('ร้านขนมบ้านสวน');
    expect(card.phone?.value).toBe('+66890005678');
    expect(card.taxId).toBeNull();
  });

  it('checks the Thai tax id digit and normalises phones', () => {
    expect(validThaiTaxId('0000000000124')).toBe(true);
    expect(validThaiTaxId('1234567890123')).toBe(false);
    expect(validThaiTaxId('1234567890121')).toBe(true);
    expect(phonesIn('โทร 089 000 1234 / 02-000-0000')).toEqual([
      { e164: '+66890001234', mobile: true },
      { e164: '+6620000000', mobile: false },
    ]);
  });

  it('groups Tesseract TSV words into lines with their mean confidence, Thai joined unless there is a real gap', () => {
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '5\t1\t1\t1\t1\t1\t0\t0\t40\t30\t91\tคุณมา',
      '5\t1\t1\t1\t1\t2\t42\t0\t20\t30\t95\tนี',
      '5\t1\t1\t1\t1\t3\t80\t0\t30\t30\t84\tใจดี',
      '4\t1\t1\t1\t2\t0\t0\t0\t10\t10\t-1\t',
      '5\t1\t1\t1\t2\t1\t0\t0\t10\t10\t80\tLINE:',
      '5\t1\t1\t1\t2\t2\t0\t0\t10\t10\t70\tmanee.cafe',
    ].join('\n');
    expect(linesFromTsv(tsv)).toEqual([
      { text: 'คุณมานี ใจดี', confidence: 90 },
      { text: 'LINE: manee.cafe', confidence: 75 },
    ]);
  });
});
