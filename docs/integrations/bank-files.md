# Bank files (D-093)

Payout runs write a bulk-transfer file with the adapter the run names (`payout_runs.bank_format_adapter`, default from the company bank account); the bank's result and statements are read back by the same adapter family (`src/integrations/bank-files/bank-files.ts`).

| Adapter | Status | Notes |
|---|---|---|
| `generic_csv` | available | The D-093 fallback for any bank that imports / exports CSV. |
| Bank-specific layouts (SCB, KBank, BBL, …) | pending | Added one adapter per bank once the bank's file specification is in hand — nothing is guessed. |

## `generic_csv`

UTF-8, RFC 4180 (quoted fields, doubled quotes, CRLF or LF), header row required, column order free, a BOM is ignored.

**Transfer file** (written by getpack): `reference, vendor_name, bank_code, account_no, account_name, amount, pay_on`. `reference` is the payout item id the bank must echo back. The file holds full account numbers: it is stored as a financial record, its generation is audited as an export, and it is only downloadable with `payouts.execute` through a short-lived signed URL.

**Confirmation** (from the bank): `reference, status` required; `bank_ref, reason` optional. `status` is `paid` or `failed`. Every item of the run needs exactly one result; unknown references are refused.

**Statement** (from the bank): `txn_date` (YYYY-MM-DD), `amount` (signed: + in, − out; never 0), `description` required; `value_date, reference, counterparty, balance` optional. A file already imported is refused; lines already imported through an overlapping file are skipped (per-account dedupe hash).
