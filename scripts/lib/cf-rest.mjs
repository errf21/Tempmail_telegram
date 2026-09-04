#!/usr/bin/env node
// ============================================================================
// cf-rest.mjs — Cloudflare REST helper for scripts/bootstrap.sh
//
// WHY THIS EXISTS: Cloudflare wrangler has no Android build ("Unsupported
// platform: android arm64 LE"), so bootstrap cannot use wrangler on Termux.
// This module drives the Cloudflare REST API directly (same technique as the
// legacy deploy.py / apply_migration.py, but wrangler.toml-driven and with
// d1_migrations bookkeeping so CI's `wrangler d1 migrations apply` stays in
// sync). Runs on plain Node >= 18 (fetch/FormData/Blob built in).
//
// Commands:
//   whoami                                   print account id (verifies token)
//   d1-list                                  list D1 databases (name, uuid)
//   d1-create <name>                         create D1 database, print uuid
//   migrate <accountId> <dbId>               apply migrations/*.sql + record
//                                            in d1_migrations (wrangler-safe)
//   deploy <accountId> <scriptName>          upload _worker.js + bindings +
//                                            vars parsed from wrangler.toml
//   secret-list <accountId> <scriptName>     print secret names
//   secret-put <accountId> <scriptName> <SECRET_NAME>   value on stdin
//   subdomain <accountId> <scriptName>       print workers.dev subdomain;
//                                            enable it for the script
//
// Auth: env CLOUDFLARE_API_TOKEN (required). Account: CLOUDFLARE_ACCOUNT_ID
// env optional (auto-detected from the token when omitted).
// NEVER prints or stores secret values.
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.cloudflare.com/client/v4";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const die = (msg) => {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
};

async function api(path, { method = "GET", body, form } = {}) {
  if (!TOKEN) die("CLOUDFLARE_API_TOKEN is not set");
  const headers = { Authorization: `Bearer ${TOKEN}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: form ? form : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!json) die(`${method} ${path}: non-JSON response (HTTP ${res.status})`);
  if (!json.success) {
    die(`${method} ${path}: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

// ---- wrangler.toml parsing (minimal, no dependency) -----------------------

function parseWranglerToml() {
  const text = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  const pick = (key) => {
    const m = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
    return m ? m[1] : "";
  };
  const vars = {};
  const varsHeader = text.match(/^\[vars\]\s*$/m);
  if (varsHeader) {
    const from = varsHeader.index + varsHeader[0].length;
    const rest = text.slice(from);
    const next = rest.match(/^\[/m); // next section header at line start
    const block = next ? rest.slice(0, next.index) : rest;
    for (const line of block.split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/);
      if (m) vars[m[1]] = m[2];
    }
  }
  let d1 = null;
  const d1Header = text.match(/^\[\[d1_databases\]\]/m);
  if (d1Header) {
    const from = d1Header.index + d1Header[0].length;
    const rest = text.slice(from);
    const next = rest.match(/^\[/m);
    const block = next ? rest.slice(0, next.index) : rest;
    const id = block.match(/database_id\s*=\s*"([^"]*)"/);
    const binding = block.match(/binding\s*=\s*"([^"]*)"/);
    if (id) d1 = { binding: binding ? binding[1] : "DB", id: id[1] };
  }
  return {
    name: pick("name"),
    main: pick("main") || "_worker.js",
    compatibility_date: pick("compatibility_date") || "2024-01-01",
    vars,
    d1,
  };
}

// ---- D1 migration runner (statement splitter ported from legacy
// apply_migration.py, plus d1_migrations bookkeeping identical to wrangler)
// ----------------------------------------------------------------------------

function splitStatements(sql) {
  const outLines = [];
  for (const line of sql.split("\n")) {
    let inQuote = null;
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inQuote = ch;
      } else if (ch === "-" && line[i + 1] === "-") {
        cut = i;
        break;
      }
    }
    outLines.push(cut === -1 ? line : line.slice(0, cut).replace(/\s+$/, ""));
  }
  return outLines
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function d1Query(accountId, dbId, sqlOrBody) {
  const body = typeof sqlOrBody === "string" ? { sql: sqlOrBody } : sqlOrBody;
  return api(`/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: "POST",
    body,
  });
}

async function cmdMigrate(accountId, dbId) {
  const dir = join(ROOT, "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) die("no migration files found in migrations/");

  // Same table shape wrangler creates; CREATE IF NOT EXISTS so wrangler on
  // CI accepts the bookkeeping either way.
  await d1Query(
    accountId,
    dbId,
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
  );
  const applied = new Set(
    (await d1Query(accountId, dbId, "SELECT name FROM d1_migrations")).result[0].results.map(
      (r) => r.name
    )
  );

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} (already applied)`);
      continue;
    }
    const statements = splitStatements(readFileSync(join(dir, file), "utf8"));
    for (const stmt of statements) {
      await d1Query(accountId, dbId, stmt);
    }
    await d1Query(accountId, dbId, {
      sql: "INSERT INTO d1_migrations (name) VALUES (?1)",
      params: [file],
    });    console.log(`+ ${file} (${statements.length} statements)`);
    ran++;
  }
  console.log(ran === 0 ? "migrations: up to date" : `migrations: applied ${ran}`);
}

// ---- worker deploy (equivalent to legacy deploy.py, toml-driven) ----------

async function cmdDeploy(accountId, scriptName) {
  const cfg = parseWranglerToml();
  if (cfg.name && cfg.name !== scriptName) {
    die(`wrangler.toml name ("${cfg.name}") != requested script "${scriptName}"`);
  }
  if (!cfg.d1 || !/^[0-9a-f-]{36}$/.test(cfg.d1.id)) {
    die("wrangler.toml has no valid D1 database_id — run the D1 bootstrap step first");
  }
  const src = readFileSync(join(ROOT, cfg.main), "utf8");
  const metadata = {
    main_module: cfg.main,
    compatibility_date: cfg.compatibility_date,
    bindings: [{ type: "d1", name: cfg.d1.binding, id: cfg.d1.id }],
    vars: cfg.vars,
  };
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  form.append(
    cfg.main,
    new Blob([src], { type: "application/javascript+module" }),
    cfg.main
  );
  const json = await api(`/accounts/${accountId}/workers/scripts/${scriptName}`, {
    method: "PUT",
    form,
  });
  console.log(`deployed ${scriptName} (D1 ${cfg.d1.id}, vars: ${Object.keys(cfg.vars).join(", ") || "none"})`);
  return json;
}

// ---- commands --------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);
const accountId = args[0] || process.env.CLOUDFLARE_ACCOUNT_ID;

switch (cmd) {
  case "dump-config": {
    console.log(JSON.stringify(parseWranglerToml(), null, 2));
    break;
  }
  case "whoami": {
    await api("/user/tokens/verify");
    if (accountId) {
      console.log(accountId);
    } else {
      const acc = await api("/accounts");
      if (!acc.result.length) die("token cannot see any account — grant Account Settings Read");
      console.log(acc.result[0].id);
    }
    break;
  }
  case "d1-list": {
    const list = await api(`/accounts/${accountId}/d1/database`);
    for (const db of list.result) console.log(`${db.name}\t${db.uuid}`);
    break;
  }
  case "d1-create": {
    const created = await api(`/accounts/${accountId}/d1/database`, {
      method: "POST",
      body: { name: args[1] },
    });
    console.log(created.result.uuid);
    break;
  }
  case "migrate": {
    await cmdMigrate(accountId, args[1]);
    break;
  }
  case "deploy": {
    await cmdDeploy(accountId, args[1]);
    break;
  }
  case "secret-list": {
    const secrets = await api(`/accounts/${accountId}/workers/scripts/${args[1]}/secrets`);
    for (const s of secrets.result) console.log(s.name);
    break;
  }
  case "secret-put": {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
    if (!text) die("empty secret value on stdin");
    await api(`/accounts/${accountId}/workers/scripts/${args[1]}/secrets`, {
      method: "PUT",
      body: { name: args[2], text, type: "secret_text" },
    });
    console.log(`secret ${args[2]} saved`);
    break;
  }
  case "subdomain": {
    const sub = await fetch(`${API}/accounts/${accountId}/workers/subdomain`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }).then((r) => r.json());
    if (!sub.success || !sub.result || !sub.result.subdomain) {
      console.error("NO_SUBDOMAIN");
      process.exit(2);
    }
    await api(`/accounts/${accountId}/workers/scripts/${args[1]}/subdomain`, {
      method: "POST",
      body: { enabled: true },
    });
    console.log(sub.result.subdomain);
    break;
  }
  default:
    die(`unknown command: ${cmd || "(none)"}`);
}
