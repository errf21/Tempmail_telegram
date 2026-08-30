import json
import os
import urllib.request
import urllib.error

account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
api_token = os.environ.get("CLOUDFLARE_API_TOKEN")
script_name = "temp-mail-bot"

if not account_id or not api_token:
    print("Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set.")
    exit(1)

url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{script_name}"

metadata = {
    "main_module": "_worker.js",
    "compatibility_date": "2024-01-01",
    "bindings": [
        {
            "name": "DB",
            "type": "d1",
            "id": "5ef2bdbb-d644-426a-b915-f20e81b7b390"
        }
    ],
    "vars": {
        # Toggle the multi-user access guard. When "true" the bot is open to
        # every Telegram chat_id (each chat keeps its own session/inbox/50-token
        # archive). When "false", the legacy TELEGRAM_USER_ID gate is used —
        # but that gate itself is stored as a secret and is NOT touched here.
        "MULTI_USER": "true"
    }
    # NOTE: BOT_TOKEN, DOMAIN, and TELEGRAM_USER_ID are stored as secrets on
    # the worker, so they survive this upload. Only the code, D1 binding, and
    # plain vars are updated.
}

worker_path = os.path.join(os.path.dirname(__file__), "_worker.js")
with open(worker_path, "rb") as f:
    script_content = f.read()

boundary = "----CloudflareWorkersBoundary7MA4YWxkTrZu0gW"
body = []

# metadata part
body.append(f"--{boundary}\r\n".encode("utf-8"))
body.append(b'Content-Disposition: form-data; name="metadata"\r\n')
body.append(b'Content-Type: application/json\r\n\r\n')
body.append(json.dumps(metadata).encode("utf-8") + b"\r\n")

# script part (_worker.js)
body.append(f"--{boundary}\r\n".encode("utf-8"))
body.append(b'Content-Disposition: form-data; name="_worker.js"; filename="_worker.js"\r\n')
body.append(b'Content-Type: application/javascript+module\r\n\r\n')
body.append(script_content + b"\r\n")

body.append(f"--{boundary}--\r\n".encode("utf-8"))

data = b"".join(body)

req = urllib.request.Request(url, data=data, method="PUT")
req.add_header("Authorization", f"Bearer {api_token}")
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

print(f"Deploying {script_name} to Cloudflare account {account_id}...")

try:
    with urllib.request.urlopen(req) as response:
        resp_data = response.read().decode("utf-8")
        print("Success response:", resp_data)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code, e.reason)
    err_body = e.read().decode("utf-8")
    print("Error response:", err_body)
except Exception as e:
    print("Error:", e)
