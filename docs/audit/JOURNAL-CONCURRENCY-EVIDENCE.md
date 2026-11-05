# Ordinary journal save/delete conflict protection

Baseline: PR #22 commit `7f5b297800c64821d7be2e0fd36ffb5c957c1718`. Its [CI42012726734](https://github.com/dejayillegal/aidaw/actions/runs/42012726734) and [CI42012719403](https://github.com/dejayillegal/aidaw/actions/runs/42012719403) both passed. This follow-up adds protection for ordinary persistence; migration already had a transactional comparison guard.

## Reproduced failures and correction

Two independent browser tabs shared native IndexedDB. Both restored one project. After the first tab saved a new note velocity, the stale tab silently overwrote it. After protecting save, the same stale tab could still delete the newer project. Bulk clear also discarded the conflicted local project despite its disk deletion being rejected. All three failures were observed before their respective corrections in `scripts/journal-concurrency-check.mjs`.

Each service now retains a small receipt of the last acknowledged journal revision: schema/version headers, record SHA256 checksum, working revision and update timestamp. An ordinary save compares that receipt with the current primary inside the same readwrite transaction that writes primary/backup. The receipt advances only after commit. Queued writes within one service remain serialized; restoration and successful migration initialize/update their receipts.

Removal uses the same comparison before deleting primary/backup. It now returns a completion promise and retains the in-memory project until durable removal succeeds. A rejected remove keeps the project available; a rejected save keeps local edits. Both report actionable `RECOVERY_CONFLICT` status. No automatic reload, silent merge, source replacement, new schema or second score owner was added. Bulk clear awaits the same guarded removal for each project selected at invocation, retains conflicted projects and removes healthy ones. Cursor-only active-project flags are not musical changes.

## Executed native cases

| Case | Result |
|---|---|
| Stale save after another tab commits | Rejected; newer primary and prior backup unchanged; local velocity 90 retained |
| Subsequent saves in winning tab | Persist normally; primary advances to 81 |
| Another healthy project in conflicted tab | Saves normally; conflicts remain scoped to one queue ID |
| Export/save of the local unsaved project snapshot | Round-trips velocity 90 without touching the winning primary |
| Stale removal | Rejected; newer primary and local item remain available |
| Bulk clear with one conflicted and one healthy project | Conflicted local copy and newer primary retained; healthy project removed |
| Simultaneous valid writers | Exactly one commits; durable primary matches that winner |
| External replacement with future envelope version 99 | Old writer rejects; original future envelope remains unchanged |
| Concurrent repeated acknowledged removal | Memory, primary and backup are removed after successful commit |

Seven grouped scenarios passed in native Chromium 153: [two-tabs.json](evidence/journal-concurrency/two-tabs.json). The runner is a separate required CI step. Full regression remains 342/342 across 38 files; strict compiler, correctness lint and production/PWA build passed.

The original Berghain envelope also passed restore/archive/idempotence/edit/save/reopen/native snapshot and four-bar native render again with these guards: [original-recovery.json](evidence/journal-concurrency/original-recovery.json).

## Limits

This is an optimistic protocol between normal application writers, which checksum every current-format record. It does not certify adversarial database edits that change content without updating its checksum, cross-version writers, cloud/device synchronization, PWA update/schema transitions, quota failures or physical interruption behavior. Those need separate tests and any necessary implementation. Complete G0–G7 acceptance and G8/release approval remain open.
