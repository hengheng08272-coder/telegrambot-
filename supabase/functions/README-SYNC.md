# ⚠️ These files are BEHIND production — do not deploy them as-is

The live functions in the Supabase project carry fixes that were made
directly in the dashboard and never came back into this repo. Deploying
this directory over them **reverts those fixes**. Known examples found
when the day-granting bug was fixed:

| Function | In production, NOT in this repo |
|---|---|
| `auto-approve-payment` | `adminChatIds()` (notify several admins); atomic `UPDATE … WHERE status='pending'` claim that stops one payment granting two months |
| `confirm-payment-proof` | same two, plus `TIER_LABEL` and the "claim before grant" ordering |
| `bakong-verify` | `adminChatIds()`; transaction-id replay guard |
| `aba-payment-callback` | `adminChatIds()`; claim-before-grant |
| `aba-payment-webhook` | `adminChatIds()`; `aba_trx_id` replay guard with migration fallback |
| `aba-notify-ingest` | `adminChatIds()`; same replay guard |
| ~~`telegram-admin-bot`~~ | **Reconciled 7 Sep 2026** — live v49 was pulled with `get_edge_function`, the follower-recording change applied on top of it, and v50 deployed. The repo file now matches production. |

Production also has two functions with no file here at all:
`episode-stream` and `khqr-gateway`.

`telegram-auto-post` was **also** behind production and was not on the
list above — the repo copy predated queue mode, `force`, HTML escaping
and the CORS fix. Reconciled the same way on 7 Sep 2026 (live v11 pulled,
edited, v12 deployed). Treat the absence of a function from this table as
"nobody has checked", not "in sync".

`group-stats` was created from this repo (7 Sep 2026), so that one is in
sync by construction.

## Before touching any of them

Pull the live source first and edit *that*:

```
# via the Supabase MCP tools
get_edge_function(project_id, function_slug)   # read what is actually running
deploy_edge_function(...)                       # push the edited version back
```

or `supabase functions download <slug>` with the CLI.

## Why this file exists

The `months * 30` day-granting fix was applied by patching each deployed
function, not by deploying this directory — precisely because deploying
this directory would have undone the double-grant guards above. Until
someone reconciles the two, treat production as the source of truth for
these seven files.
