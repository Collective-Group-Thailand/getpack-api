/**
 * Bank file adapters (D-093): bulk-transfer files for payout runs, the bank's confirmation of them, and
 * statement files. One adapter per bank format; `generic_csv` works with any bank that accepts / exports a
 * CSV (the fallback D-093 names). Bank-specific layouts are added as adapters once the bank's file
 * specification is in hand — nothing is guessed.
 */

export interface TransferInstruction {
  /** The payout item's public id: the reference the bank echoes back in its confirmation. */
  reference: string;
  vendorName: string;
  bankCode: string;
  accountNo: string;
  accountName: string;
  amount: string;
  payOn: string;
}

export interface TransferConfirmation {
  reference: string;
  status: 'paid' | 'failed';
  bankRef: string | null;
  reason: string | null;
}

export interface StatementRow {
  txnDate: string;
  valueDate: string | null;
  amount: string;
  description: string;
  reference: string | null;
  counterparty: string | null;
  balance: string | null;
}

export interface BankFileAdapter {
  readonly key: string;
  readonly description: string;
  transferFile(instructions: TransferInstruction[], meta: { runNo: string; debitAccountLast4: string }): { fileName: string; mimeType: string; body: Buffer };
  parseConfirmation(body: Buffer): TransferConfirmation[];
  parseStatement(body: Buffer): StatementRow[];
}

export class BankFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankFileError';
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^-?\d{1,12}(\.\d{1,2})?$/;

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

function table(body: Buffer, required: string[]): Record<string, string>[] {
  const rows = parseCsv(body.toString('utf8').replace(/^\uFEFF/, ''));
  if (rows.length === 0) throw new BankFileError('the file is empty');
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length > 0) throw new BankFileError(`missing column(s) ${missing.join(', ')}`);
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** The generic CSV format (D-093 fallback), documented in docs/integrations/bank-files.md. */
export class GenericCsvBankFileAdapter implements BankFileAdapter {
  readonly key = 'generic_csv';
  readonly description = 'Generic CSV (UTF-8): transfers, confirmations and statements with fixed column names';

  transferFile(instructions: TransferInstruction[], meta: { runNo: string; debitAccountLast4: string }) {
    const lines = [
      ['reference', 'vendor_name', 'bank_code', 'account_no', 'account_name', 'amount', 'pay_on'].join(','),
      ...instructions.map((i) =>
        [i.reference, i.vendorName, i.bankCode, i.accountNo, i.accountName, i.amount, i.payOn].map(csvField).join(','),
      ),
    ];
    return {
      fileName: `payout-${meta.runNo}-from-x${meta.debitAccountLast4}.csv`,
      mimeType: 'text/csv',
      body: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'),
    };
  }

  parseConfirmation(body: Buffer): TransferConfirmation[] {
    return table(body, ['reference', 'status']).map((r, i) => {
      const status = r['status']!.toLowerCase();
      if (status !== 'paid' && status !== 'failed') throw new BankFileError(`row ${i + 2}: status must be paid or failed`);
      return { reference: r['reference']!, status, bankRef: r['bank_ref'] || null, reason: r['reason'] || null };
    });
  }

  parseStatement(body: Buffer): StatementRow[] {
    return table(body, ['txn_date', 'amount', 'description']).map((r, i) => {
      const at = `row ${i + 2}`;
      if (!DAY.test(r['txn_date']!)) throw new BankFileError(`${at}: txn_date must be YYYY-MM-DD`);
      if (r['value_date'] && !DAY.test(r['value_date'])) throw new BankFileError(`${at}: value_date must be YYYY-MM-DD`);
      if (!AMOUNT.test(r['amount']!) || Number(r['amount']) === 0) throw new BankFileError(`${at}: amount must be a non-zero decimal`);
      if (r['balance'] && !AMOUNT.test(r['balance'])) throw new BankFileError(`${at}: balance must be a decimal`);
      return {
        txnDate: r['txn_date']!,
        valueDate: r['value_date'] || null,
        amount: r['amount']!,
        description: r['description'] || '-',
        reference: r['reference'] || null,
        counterparty: r['counterparty'] || null,
        balance: r['balance'] || null,
      };
    });
  }
}

export const BANK_FILE_ADAPTERS: Record<string, BankFileAdapter> = {
  generic_csv: new GenericCsvBankFileAdapter(),
};

export function bankFileAdapter(key: string): BankFileAdapter {
  const adapter = BANK_FILE_ADAPTERS[key];
  if (!adapter) throw new BankFileError(`no bank file adapter "${key}"`);
  return adapter;
}
