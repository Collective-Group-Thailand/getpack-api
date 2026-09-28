import {
  bankFileAdapter,
  BankFileError,
  GenericCsvBankFileAdapter,
  parseCsv,
} from '@integrations/bank-files/bank-files';

describe('bank file adapters (D-093)', () => {
  const adapter = new GenericCsvBankFileAdapter();

  it('parses RFC 4180 CSV with quotes, doubled quotes, CRLF and blank lines', () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n\r\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('writes a transfer file whose fields round-trip and never loses a comma in a name', () => {
    const file = adapter.transferFile(
      [
        {
          reference: 'ref-1',
          vendorName: 'โรงพิมพ์, ตัวอย่าง (fake)',
          bankCode: '014',
          accountNo: '0000000009',
          accountName: 'X',
          amount: '5504.40',
          payOn: '2026-10-27',
        },
      ],
      { runNo: 'PR1', debitAccountLast4: '1234' },
    );
    expect(file.fileName).toBe('payout-PR1-from-x1234.csv');
    const rows = parseCsv(file.body.toString('utf8'));
    expect(rows[0]).toEqual([
      'reference',
      'vendor_name',
      'bank_code',
      'account_no',
      'account_name',
      'amount',
      'pay_on',
    ]);
    expect(rows[1]).toEqual([
      'ref-1',
      'โรงพิมพ์, ตัวอย่าง (fake)',
      '014',
      '0000000009',
      'X',
      '5504.40',
      '2026-10-27',
    ]);
  });

  it('parses confirmations and refuses unknown statuses', () => {
    const ok = adapter.parseConfirmation(
      Buffer.from('reference,status,bank_ref,reason\nr1,PAID,B1,\nr2,failed,,closed\n'),
    );
    expect(ok).toEqual([
      { reference: 'r1', status: 'paid', bankRef: 'B1', reason: null },
      { reference: 'r2', status: 'failed', bankRef: null, reason: 'closed' },
    ]);
    expect(() => adapter.parseConfirmation(Buffer.from('reference,status\nr1,maybe\n'))).toThrow(
      BankFileError,
    );
    expect(() => adapter.parseConfirmation(Buffer.from('reference\nr1\n'))).toThrow(/missing column/);
  });

  it('parses statements with a BOM and validates dates and amounts', () => {
    const rows = adapter.parseStatement(
      Buffer.from(
        '﻿txn_date,amount,description,reference,balance\n2026-10-27,-5504.40,TRF OUT,PR1,94495.60\n',
      ),
    );
    expect(rows).toEqual([
      {
        txnDate: '2026-10-27',
        valueDate: null,
        amount: '-5504.40',
        description: 'TRF OUT',
        reference: 'PR1',
        counterparty: null,
        balance: '94495.60',
      },
    ]);
    expect(() =>
      adapter.parseStatement(Buffer.from('txn_date,amount,description\n27/10/2026,1.00,x\n')),
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      adapter.parseStatement(Buffer.from('txn_date,amount,description\n2026-10-27,0,x\n')),
    ).toThrow(/non-zero/);
    expect(() => adapter.parseStatement(Buffer.from(''))).toThrow(/empty/);
  });

  it('resolves adapters by key and refuses unknown ones', () => {
    expect(bankFileAdapter('generic_csv').key).toBe('generic_csv');
    expect(() => bankFileAdapter('kbank_fixed_width')).toThrow(BankFileError);
  });
});
