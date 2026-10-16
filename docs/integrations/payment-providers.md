# Payment providers — what the adapters implement (B3.2)

Read from the providers' public documentation on 2026-09-27 (D-176). Every adapter is disabled by a feature flag
until Collective Group (Thailand) holds its own merchant account (D-005); each has an in-memory fake used by
`pnpm dev` and the tests. Items marked **to confirm** must be settled with the provider during onboarding.

## SCB Open API (QR 30 PromptPay bill payment, QR CS cross-bank)
- **Auth:** `POST /v1/oauth/token` with headers `resourceOwnerId` (API key), `requestUId` (unique per call) and body
  `applicationKey`, `applicationSecret` → `data.accessToken` (Bearer, `expiresIn` 1800 s). Envelope
  `{status:{code,description},data}`, success code **1000**.
- **Create QR:** `POST /v1/payment/qrcode/create`.
  - QR 30 (`qrType: "PP"`): `ppType: "BILLERID"`, `ppId` (Biller ID, 15), `amount` (string), `ref1` / `ref2` / `ref3`
    (`[A-Z0-9]` ≤ 20; `ref3` = the Ref3 prefix of the merchant profile + value).
  - QR CS (`qrType: "CS"`): `merchantId`, `terminalId`, `invoice` (unique, `[A-Z0-9]`), `csExtExpiryTime` (minutes).
  - Response `qrRawData` (EMVCo string) and `qrImage` (base64).
  - getpack sends the payment `reference_code` as `ref1` (QR 30) or `invoice` (QR CS).
- **Payment confirmation callback:** SCB → the URL registered per Biller ID + Ref3 prefix (QR 30) or Merchant ID
  (QR CS), only on success. Up to 3 retries 12 s apart. getpack answers
  `{"resCode":"00","resDesc":"success","transactionId":"<echo>"}`.
  - **The callback carries no signature.** The adapter therefore **confirms every callback by inquiry**
    (`GET /v1/payment/billpayment/inquiry?eventCode=00300100&transactionDate=…&billerId=…&reference1=…`, or
    `GET /v1/payment/qrcode/creditcard/{qrId}` for QR CS) before the payment is accepted.
  - The callback is stored once per `transactionId` (`webhook_inbox`); `payments (provider, provider_ref)` is unique,
    so a payment is never accepted twice.
  - Time zones: QR 30 callbacks use GMT+7 ISO; QR CS callbacks use GMT.
- **Refunds:** no public refund API for QR 30 bill payments (`/v1/payment/qrcode/void` is "document specification
  only", and the callback does not carry its `bpReference`). SCB refunds are executed by **bank transfer** (Finance
  records the transfer) until SCB confirms an API. **To confirm:** production base URL, callback source IP list,
  void / refund API for QR 30 and QR CS.

## 2C2P PGW v4.x (card, online banking)
- **Signing:** JWT **HS256** with the merchant secret key for payment token, inquiry and backend notification. Bodies
  are `{"payload":"<JWT>"}` in both directions, and every response JWT is verified.
- **Payment token:** `POST https://{sandbox-}pgw.2c2p.com/payment/4.5/paymentToken` with `merchantID`, `invoiceNo`
  (getpack `reference_code`), `description`, `amount` (number), `currencyCode: "THB"`, `paymentChannel` (`["CC"]` card,
  `["IMBANK"]`-style channels for online banking — **to confirm per contract**), `idempotencyID`, `paymentExpiry`,
  `frontendReturnUrl`, `backendReturnUrl` → `webPaymentUrl`, `paymentToken` (30 min), `respCode "0000"`.
- **Backend notification:** `{"payload":"<JWT>"}` to `/webhooks/2c2p/payment`. The JWT signature is the
  authenticity check. `respCode "0000"` = success; `tranRef` / `referenceNo` identify the transaction; `amount` may
  be a string or a number. The browser return (`respCode "2000"`) is never trusted: inquiry
  (`POST /payment/4.5/paymentInquiry` by `invoiceNo`) confirms.
- **Refund:** Payment Process API (`/PaymentAction/2.0/action`, `processType: R`) with an XML body in **JWE
  (RSA-OAEP + A256GCM, 2C2P public key) + JWS PS256 (merchant private key)**; `status RF` = refunded, `RP` = pending.
  **To confirm:** the channel codes in the contract, the backend-notification retry policy, the merchant key pair
  and the version string (4.3 vs 4.5).

## Slip2Go (bank-transfer slips, D-061)
- **Auth:** `Authorization: Bearer {secretKey}`; optional IP allow-list.
- **Verify:** `POST {apiUrl}/api/verify-slip/qr-image/info` (multipart `file` + `payload` JSON) or
  `/api/verify-slip/qr-code/info` (`{payload:{qrCode, checkCondition}}`), with
  `checkCondition = {checkDuplicate: true, checkReceiver: [{accountType, accountNumber}], checkAmount: {type:"eq",
  amount}, checkDate: {type:"gte", date}}`. The receiver accounts are getpack's collection accounts (settings).
- **Result codes:**
  - `200200` valid → payment accepted automatically.
  - `200401` receiver, `200402` amount or `200403` date mismatch → Finance queue.
  - `200404` not found or `200500` fraud → Finance queue.
  - `200501` duplicate → rejected.
  - `200502` or `5xxxxx` provider error → Finance queue (4 business hours, D-061, D-175).
  - Response data gives `transRef`, `amount` (number), `dateTime` (UTC), and receiver / sender with masked accounts.
- `slips.bank_trans_ref` is unique once passed / approved, whatever the provider says.
- **Webhook:** only for the queue API, with no documented signature. `/webhooks/slip-verify` stores the callback
  and re-fetches the result (`GET /api/verify-slip/{referenceId}`) before trusting it.
- **To confirm:** API host, duplicate-check scope, webhook configuration.
