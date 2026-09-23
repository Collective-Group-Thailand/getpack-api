# RBAC matrix — packio-api

> **Generated** by `pnpm rbac:build` from `src/modules/iam/roles.catalog.ts`, `permissions.catalog.ts` and
> `prisma/seed/data/reference.ts`. Do not edit by hand. Roles per D-140; cost and margin visibility per D-141;
> factories see only delivery contact data of customers (D-142, enforced in projections, not by a permission).
> Grants where a decision is silent are the narrowest that lets the role work (docs/PROGRESS.md, B1.2) — **review**.

Legend: ● granted · ◆ granted and sensitive (cost/margin data, D-141).

## Packio staff (platform scope)

| Permission | `superadmin` | `c_level` | `vp` | `director` | `admin` | `cs` | `cs_lead` | `prepress` | `finance` | `finance_manager` | `logistics` | `marketing` | `partner_manager` | `auditor` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `settings.read` — Read platform settings and their history | ● | ● | ● | ● | ● |  |  |  | ● | ● |  |  | ● | ● |
| `settings.read_sensitive` — Read settings flagged sensitive | ◆ | ◆ |  |  |  |  |  |  |  | ◆ |  |  |  |  |
| `settings.change` — Create a new effective-dated setting version (D-063) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `feature_flags.read` — Read feature flags | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `feature_flags.manage` — Change feature flags | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `entities.manage` — Manage legal entities (D-092) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `calendars.read` — Read business calendars | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `calendars.manage` — Key in public holidays and factory closures (D-161) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `consent_purposes.manage` — Manage consent purposes and their texts | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `approvals.read` — Read approval requests | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `approvals.act` — Approve or reject requests routed to the role | ● | ● | ● | ● |  |  |  |  | ● | ● |  | ● | ● |  |
| `approvals.delegate` — Delegate own approvals for a period | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `approval_policies.manage` — Create approval policy versions (D-063) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `users.read` — Read staff, partner and customer accounts | ● |  |  |  | ● |  |  |  |  |  |  |  |  | ● |
| `users.manage` — Create, deactivate and edit accounts | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `roles.assign` — Grant and revoke roles (D-140) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `roles.manage` — Edit roles and their permissions (D-140) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `sod_rules.manage` — Edit segregation-of-duties rules | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `audit_logs.read` — Read the audit log | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  | ● |
| `audit_logs.export` — Export the audit log (itself audited) | ● |  |  |  |  |  |  |  |  | ● |  |  |  | ● |
| `files.upload` — Upload files | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `files.read` — Download files of records the user can see | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `notification_templates.manage` — Edit and publish notification templates | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `notification_routes.manage` — Edit the notification routing matrix (D-143) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `outbox.manage` — List dead-lettered domain events and replay them | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `factory_cost.read` — See full factory buy prices and costs (D-141, D-044) | ◆ | ◆ | ◆ |  |  |  |  |  | ◆ | ◆ |  |  | ◆ |  |
| `margin.read` — See margins in amounts and percent (D-141) | ◆ | ◆ | ◆ |  |  |  |  |  | ◆ | ◆ |  |  | ◆ |  |
| `margin.read_pct_when_discounting` — See the resulting margin % while applying a discount (D-141, D-052) | ◆ |  |  |  |  | ◆ | ◆ |  |  |  |  |  |  |  |

| Role | Name (th) | Name (en) |
|---|---|---|
| `superadmin` | ซูเปอร์แอดมิน | Superadmin |
| `c_level` | ผู้บริหารระดับสูง | C-Level |
| `vp` | รองประธาน | VP |
| `director` | ผู้อำนวยการ | Director |
| `admin` | ผู้ดูแลระบบ | Admin |
| `cs` | ฝ่ายบริการลูกค้า | CS |
| `cs_lead` | หัวหน้าฝ่ายบริการลูกค้า | CS Lead |
| `prepress` | ฝ่ายเตรียมพิมพ์ | Prepress |
| `finance` | ฝ่ายการเงิน | Finance |
| `finance_manager` | ผู้จัดการฝ่ายการเงิน | Finance Manager |
| `logistics` | ฝ่ายขนส่ง | Logistics |
| `marketing` | ฝ่ายการตลาด | Marketing |
| `partner_manager` | ผู้จัดการพันธมิตร | Partner Manager |
| `auditor` | ผู้ตรวจสอบบัญชี | Auditor (read-only) |

## Partner factory (factory scope)

| Permission | `factory_owner` | `factory_planner` | `factory_operator` | `factory_qc` | `factory_shipping` | `factory_accountant` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `factory_profile.read` — Read the own factory profile | ● | ● | ● | ● | ● | ● |
| `factory_users.manage` — Manage users of the own factory | ● |  |  |  |  |  |

| Role | Name (th) | Name (en) |
|---|---|---|
| `factory_owner` | เจ้าของโรงงาน | Factory Owner |
| `factory_planner` | ผู้วางแผนการผลิต | Planner |
| `factory_operator` | ผู้ปฏิบัติงาน | Operator |
| `factory_qc` | ฝ่ายควบคุมคุณภาพ | QC |
| `factory_shipping` | ฝ่ายจัดส่ง | Shipping |
| `factory_accountant` | ฝ่ายบัญชีโรงงาน | Factory Accountant |

## B2B company members (company scope)

| Permission | `company_admin` | `company_buyer` | `company_approver` | `company_accountant` |
|---|:-:|:-:|:-:|:-:|
| `company_profile.read` — Read the own company profile | ● | ● | ● | ● |
| `company_members.manage` — Invite and remove company members | ● |  |  |  |
| `company_orders.approve` — Approve company orders above the company threshold (D-123) |  |  | ● |  |
| `company_documents.read` — Read company invoices and statements | ● |  |  | ● |

| Role | Name (th) | Name (en) |
|---|---|---|
| `company_admin` | ผู้ดูแลบัญชีบริษัท | Company Admin |
| `company_buyer` | ผู้สั่งซื้อ | Buyer |
| `company_approver` | ผู้อนุมัติ | Approver |
| `company_accountant` | ฝ่ายบัญชีบริษัท | Accountant |

## Segregation of duties (`accounting-design.md` §8)

| Rule | Kind | Pair | Match | Decisions |
|---|---|---|---|---|
| The creator of a payout run cannot approve it (D-022, §8) | action_pair | `payout_run.create` → `payout_run.approve` | same_subject | D-022, D-033 |
| Whoever records a vendor bill cannot change that vendor's bank account (§8) | action_pair | `vendor_invoice.record` → `vendor_bank_account.change` | same_vendor | D-033 |
| The maker of a manual journal cannot approve it (§8) | action_pair | `journal.create` → `journal.approve` | same_subject | D-033 |
| Whoever requests a credit note cannot issue it (§8) | action_pair | `credit_note.request` → `credit_note.issue` | same_subject | D-033 |
| Whoever requests a refund cannot approve it (§8) | action_pair | `refund.request` → `refund.approve` | same_subject | D-033 |
| Whoever proposes a write-off cannot approve it (§8) | action_pair | `write_off.request` → `write_off.approve` | same_subject | D-033 |
| Whoever changes a bank account cannot approve the change (§8) | action_pair | `vendor_bank_account.change` → `vendor_bank_account.approve` | same_subject | D-033 |
| D-168 the time-boxed Auditor role is never combined with Finance (auditor independence, §8) | role_pair | `auditor` × `finance` | — | D-168, D-140 |
| D-168 the time-boxed Auditor role is never combined with Finance Manager (auditor independence, §8) | role_pair | `auditor` × `finance_manager` | — | D-168, D-140 |

Also enforced by code: nobody grants or revokes their own roles; staff roles can be granted only by someone
who holds all of their permissions; an approval request cannot be approved by its requester, and one person
approves at most one step of a request (ADR-0006).
