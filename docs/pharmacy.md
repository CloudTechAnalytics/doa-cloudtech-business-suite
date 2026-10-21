# Pharmacy & medicine store

Industry `pharmacy` inside the CloudTech Business Suite. It reuses the shared tenancy, roles, subscriptions, stock ledger, sales, purchasing,
expenses, audit log and the mart's stock screens, and adds batches and expiry, restricted-medicine dispensing and prescriptions.

## What it enforces (server side, in PostgreSQL)

| Rule | Where |
| --- | --- |
| Every medicine has a classification: over the counter, prescription only, controlled, device, general | `pharmacy_medicine_profiles` |
| Prescription-only and controlled medicines cannot be put on an ordinary sale | trigger `sale_items_pharmacy_guard` (a sale is only allowed from `pharmacy_dispense()`) |
| Stock is held by batch; outgoing stock takes the earliest-expiring valid batch | trigger `mart_track_lots` |
| Expired, quarantined and undated batches are never allocated, even if the product has stock on hand | same trigger (the movement fails and rolls back) |
| Customer returns and stock found by an adjustment wait in quarantine until a pharmacist confirms batch and expiry | same trigger, `pharmacy_set_batch_status()` |
| Goods receipts need batch and expiry; only the accepted quantity enters stock; rejected goods need a reason | `pharmacy_receive_goods()` |
| Dispensing needs the `pharmacy.dispense` permission and an approved, in-date prescription; partial dispensing is tracked per item | `pharmacy_review_prescription()`, `pharmacy_dispense()` |
| Whole-unit products (tablets, capsules) cannot be sold or received in fractions | sale-item guard and receiving |
| Prescriptions and dispensing history are visible only with `pharmacy.rx`; notes are kept out of the audit metadata | RLS, `audit_row_change('notes', 'review_note')` |
| Disposal of a named batch is manager-only and records a loss and an event | `pharmacy_dispose_batch()` |
| Idempotency on receiving, dispensing, disposal and prescription creation | `_idem_check` / `_idem_store` |

## Roles and permissions

| Permission | Owner | Admin | Manager | Pharmacist | Technician |
| --- | --- | --- | --- | --- | --- |
| `pharmacy.manage` (define medicines, dispose, settings) | yes | yes | yes | no | no |
| `pharmacy.rx` (enter and see prescriptions) | yes | yes | yes | yes | yes |
| `pharmacy.dispense` (review, approve, dispense restricted medicines) | yes | yes | **no** | yes | no |

Cashiers, storekeepers (inventory officers) and accountants cannot see prescriptions at all. The role templates do not replace the licensing
rules of the pharmacy's jurisdiction: owners should assign `pharmacy.dispense` only to licensed staff.

## Migration

`supabase/migrations/20261021000015_pharmacy.sql`: new roles (`pharmacist`, `pharmacy_technician`), permissions, `pharmacy-*` modules, template
and plan rows, `pharmacy_settings`, `pharmacy_medicine_profiles`, batch status columns on `mart_lots`, `pharmacy_batch_events`, goods receipts,
prescriptions, dispensings, views (`pharmacy_medicines`, `pharmacy_batches`, `pharmacy_prescription_list`), RLS, audit triggers and the functions
above. `_mart_guard` now maps a pharmacy business's `retail-*` checks to its `pharmacy-*` modules so the mart's counts, losses, supplier returns,
shifts and overview work unchanged. Rollback: drop the objects created here, restore `mart_track_lots` and `_mart_guard` from migration 14,
delete the new role, permission and module rows.

## Tests

- `tests/integration/pharmacy.test.ts`: 23 database tests (modules and roles, classification, receiving with rejections, purchase-order receipts,
  FEFO, expired and quarantined stock, disposal, returns into quarantine, restricted sales, the prescription workflow, visibility, overview, counts,
  isolation, settings).
- `tests/integration/demo-pharmacy.test.ts`: 11 tests that the browser demo follows the same rules.
- Registry, landing, consistency and role-parity tests were updated for the new industry and roles.

Manual checks: sign in as `pharmacist@demo.test` (password `demo1234`), open CarePlus Pharmacy, review the seeded prescription, dispense it, then
open Batches & Expiry and quarantine or dispose a batch.

## Deployment

No new environment variables. Apply the migration to the Supabase project, then regenerate nothing else: the app reads the new views and functions
directly. Existing pharmacy businesses (none could be created before) get the modules automatically; new ones get them from the template.

## Limitations

- Branches: stock is per location. Transfers between branches (with an in-transit state) are not built; `transfer_*` movements bypass batch tracking.
- Concurrent sales are made safe by row locks on the batch rows and the ledger's no-negative-stock rule, but they are not exercised by an automated
  test (the test database is a single connection).
- Prescription attachments, refill counting beyond a recorded number, and a printable prescription label are not built.
- Patients are the shared customer records plus a free-text patient name on each prescription; there is no separate protected patient register
  and no retention or deletion workflow yet.
- Notifications are the dashboard's in-app alerts; no email or WhatsApp delivery exists.
- Opening stock is entered by receiving goods; the catalogue CSV import never creates stock.
- The sales receipt does not print batch numbers; reports are the mart's reports plus the pharmacy dashboard and the Batches & Expiry screen.
- Regulatory content (controlled-medicine registers, NAFDAC and NDPA obligations) must be confirmed with qualified professionals before production use.
