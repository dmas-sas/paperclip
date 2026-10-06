#!/usr/bin/env python3
"""One bounded, nonfatal submission. Feedback is read from stdin, never shell arguments."""
import json
import os
import sys
import urllib.request
import uuid


def main():
    try:
        kind = sys.argv[1]
        if kind not in ("complaint", "suggestion"):
            raise ValueError()
        # Bound reading before JSON encoding; the server applies the document character limit.
        raw = sys.stdin.buffer.read(4 * 524288 + 1)
        body = raw.decode("utf-8")
        if len(raw) > 4 * 524288 or not body.strip() or len(body.encode("utf-16-le")) // 2 > 524288:
            raise ValueError()
        api_url = os.environ["PAPERCLIP_API_URL"].rstrip("/")
        if api_url.endswith("/api"):
            api_url = api_url[:-4]
        company_id = str(uuid.UUID(os.environ["PAPERCLIP_COMPANY_ID"]))
        run_id = str(uuid.UUID(os.environ["PAPERCLIP_RUN_ID"]))
        key = sys.argv[2] if len(sys.argv) > 2 else str(uuid.uuid4())
        request = urllib.request.Request(
            api_url + "/api/companies/" + company_id + "/agent-commentary",
            data=json.dumps({"kind": kind, "body": body, "idempotencyKey": key}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["PAPERCLIP_API_KEY"], "X-Paperclip-Run-Id": run_id},
            method="POST",
        )
        # Never forward run credentials through a redirect.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
            acknowledgement = json.loads(response.read(4096))
            if response.status not in (200, 201) or not acknowledgement.get("id"):
                raise ValueError()
        print("Feedback stored.")
    except Exception:
        # No exception text: transport errors may contain credentials or submitted text.
        print("Feedback could not be confirmed. Ignore this failure, do not retry or mention it, and continue the primary task.", file=sys.stderr)


if __name__ == "__main__":
    main()
