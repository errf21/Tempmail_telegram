#!/usr/bin/env python3
"""Apply a SQL migration file to the remote D1 database.

Splits the file on ';' boundaries (respecting strings/comments) and POSTs
each non-empty statement to the D1 query endpoint as a single `sql` field.
Used because the D1 REST endpoint doesn't accept a multi-statement payload.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
DB_ID = os.environ.get("D1_DATABASE_ID")

if not ACCOUNT_ID or not API_TOKEN or not DB_ID:
    print("Error: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and D1_DATABASE_ID must be set.")
    sys.exit(1)

if len(sys.argv) < 2:
    print("Usage: apply_migration.py <path-to-sql-file>")
    sys.exit(1)

sql_path = sys.argv[1]
with open(sql_path, "r", encoding="utf-8") as f:
    raw = f.read()

# Strip line comments (-- ...) before splitting on ';'.
def strip_line_comments(s):
    out_lines = []
    for line in s.splitlines():
        idx = line.find("--")
        if idx == -1:
            out_lines.append(line)
        else:
            # Keep the part before the comment unless we're inside a string.
            # Simple heuristic: if "--" is not inside a quoted string, drop it.
            in_quote = None
            cut = -1
            for i, ch in enumerate(line):
                if in_quote:
                    if ch == in_quote:
                        in_quote = None
                else:
                    if ch in ('"', "'", "`"):
                        in_quote = ch
                    elif ch == "-" and i + 1 < len(line) and line[i + 1] == "-":
                        cut = i
                        break
            if cut == -1:
                out_lines.append(line)
            else:
                out_lines.append(line[:cut].rstrip())
    return "\n".join(out_lines)

cleaned = strip_line_comments(raw)

# Split on ';' at the top level (no nested SQL is allowed in DDL anyway).
statements = [stmt.strip() for stmt in cleaned.split(";") if stmt.strip()]

url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query"
headers = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}

ok = 0
fail = 0
for i, stmt in enumerate(statements, 1):
    body = json.dumps({"sql": stmt}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as response:
            resp_data = response.read().decode("utf-8")
            parsed = json.loads(resp_data)
            if parsed.get("success"):
                ok += 1
                print(f"[{i}/{len(statements)}] OK: {stmt.splitlines()[0][:80]}")
            else:
                fail += 1
                print(f"[{i}/{len(statements)}] FAIL: {stmt.splitlines()[0][:80]}")
                print("   ", parsed.get("errors"))
    except urllib.error.HTTPError as e:
        fail += 1
        print(f"[{i}/{len(statements)}] HTTP {e.code} {e.reason}: {stmt.splitlines()[0][:80]}")
        print("   ", e.read().decode("utf-8"))
    except Exception as e:
        fail += 1
        print(f"[{i}/{len(statements)}] ERROR: {e}")

print(f"\nApplied {ok}/{len(statements)} statements ({fail} failed).")
sys.exit(0 if fail == 0 else 1)
