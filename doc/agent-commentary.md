# Agent complaints and suggestions

Agents submit incidental feedback into the current instance's `agent_commentary`
table. Complaints preserve a raw reaction; suggestions describe an improvement.
Both are free-form, internally attributed records, not anonymous feedback.

## Agent entry points

Skill-capable legacy adapters automatically receive `complain` and
`suggestion-box` alongside the `paperclip` operational skill, including existing
agents with empty optional-skill selections. The shared helper lives in that
operational skill at `scripts/submit-agent-commentary.py`. It reads the body
from stdin and uses the existing `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`,
`PAPERCLIP_COMPANY_ID`, and `PAPERCLIP_RUN_ID`. Python 3 is required for the helper;
custom runtimes can call HTTP directly. Sandboxed runs use the callback bridge.

Native runs receive `submit_complaint({body, idempotencyKey})` and
`submit_suggestion({body, idempotencyKey})` in standard, ask, and planning modes.
Specialized completion-review runs retain their restricted tool set. Native
submission uses the bound authority without a shell or API credential.
Submit before finishing the run.

Instructions closely adapt Warp's
[complain](https://github.com/warpdotdev/common-skills/blob/main/.agents/skills/complain/SKILL.md)
and [suggestion-box](https://github.com/warpdotdev/common-skills/blob/main/.agents/skills/suggestion-box/SKILL.md)
skills, with their MIT notices included. Paperclip changes the transport,
attribution, suggestion form, and size limit. Agents submit proactively when
warranted, without routine previews or announcements, then continue working.
Brevity and at most three suggestions per run are guidance, not server quotas.
Do not report the same incident through both paths or retry failed submissions.

## HTTP contract

`POST /api/companies/:companyId/agent-commentary` accepts an authenticated agent
and its active run (`Authorization: Bearer …`, `X-Paperclip-Run-Id: …`):

```json
{"kind":"suggestion","body":"The tool returned before persistence completed. Wait for the write before returning success.","idempotencyKey":"write-completion-1"}
```

Only these three fields are accepted. Identity and the optional task reference
are server-derived. Board callers cannot impersonate agent feedback. Native runs
use their dedicated tools rather than this legacy HTTP path.

Bodies must contain non-whitespace text and may contain up to 524,288 JavaScript
string code units, matching ordinary issue documents. No truncation is applied.
Existing 10 MiB HTTP and callback bridge request limits remain. Keys are nonempty
and at most 240 characters.

Creation returns HTTP 201 with `{id, kind, createdAt, replayed:false}`. Identical
replay in the same company/run returns HTTP 200 with the same ID and timestamp
and `replayed:true`. Conflicting key reuse returns 409. Invalid input returns 400;
invalid authority returns 401/403; storage failure returns a sanitized 503.
Authorization precedes replay. The helper accepts an optional second argument
for a stable key, generating one otherwise. It makes one request with a
10-second socket timeout and exits zero on failure with a content-free diagnostic.
It never follows redirects with credentials or claims an uncertain write succeeded.

## Storage and inspection

Rows contain company, agent, run, nullable issue, kind, body, retry key, payload
hash, and timestamp. Known run secrets and credential syntax are redacted before
storage; instructions remain essential because redaction cannot guarantee
secrecy. Writes and one content-free activity record commit together. Feedback
bodies are excluded from HTTP diagnostics and dedicated mutation receipts.

There is no feedback UI, read API, notification, automatic task creation, or
external forwarding. This is separate from first-party Telemetry, OpenTelemetry
Observability, and the run log. Ordinary provider transcripts can still contain
submitted tool arguments; there is no anonymity or ephemeral-storage promise.

Authorized operators inspect the instance database, for example:

```sql
SELECT id, kind, body, agent_id, run_id, issue_id, created_at
FROM agent_commentary
WHERE company_id = '<company UUID>'
ORDER BY created_at DESC;
```

The service enforces company/run ownership. Foreign keys clear the task reference
on task deletion and cascade deletion with its run, agent, or company. Normal
logical database backups include these rows. No retention scheduler or backfill.

## Verification

Focused coverage lives in `server/src/__tests__/agent-commentary.integration.test.ts`,
`agent-commentary-skills.test.ts`, the shared validator tests, and the HTTP logger
and sandbox callback bridge suites. These exercise real PostgreSQL and routes,
atomic audit rollback, replay races, authority changes, deletion, default mounts,
Unicode, and the exact document-body boundary.

The opt-in live smoke uses existing Codex login credentials, copied to a private
temporary home, and a disposable instance database. It calls the real legacy
adapter and production native-session executor. It incurs normal provider usage:

```sh
node cli/node_modules/tsx/dist/cli.mjs server/scripts/verify-agent-commentary-live.ts
```

Both paths passed on 2026-10-06. Each persisted one complaint and one suggestion
with company, agent, run, and task attribution; each then wrote the continuation
marker. Both exited zero, left task status unchanged, created no task comments,
and recorded two content-free activity entries. The script emits the attributed
row IDs and timestamps as evidence and deletes its temporary data and credentials.
