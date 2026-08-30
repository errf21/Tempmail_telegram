/**
 * In-process shim that emulates the Cloudflare D1 surface used by the
 * worker's `db.*` helpers. Built on `node:sqlite` so we can run the
 * full migration + the real SQL statements without spinning up a real D1.
 *
 * Only the subset of the D1 API we use is implemented:
 *   - env.DB.prepare(sql).bind(...).first()
 *   - env.DB.prepare(sql).bind(...).all()   -> { results, success, meta }
 *   - env.DB.prepare(sql).bind(...).run()   -> { success, meta }
 *   - env.DB.batch([stmt, stmt, ...])       -> sequential
 *
 * The D1 API also supports `.raw()` and `.all()` with no bind; we only
 * use the bind form so the implementation stays small.
 */

import { DatabaseSync } from "node:sqlite";

export function makeD1FromSql(sqlText) {
  const db = new DatabaseSync(":memory:");
  db.exec(sqlText);

  function execAll(sql, binds) {
    const stmt = db.prepare(sql);
    if (binds && binds.length) stmt.bind(...binds);
    // Detect SELECT vs non-SELECT by leading keyword.
    const head = sql.trim().split(/\s+/, 1)[0].toLowerCase();
    if (head === "select" || head === "with" || head === "pragma") {
      const rows = stmt.all();
      return { results: rows, success: true, meta: { changes: 0, last_row_id: 0, rows_read: rows.length, rows_written: 0 } };
    }
    const info = stmt.run();
    return { success: true, meta: { changes: info.changes || 0, last_row_id: info.lastInsertRowid || 0, rows_read: 0, rows_written: info.changes || 0 } };
  }

  function makeStatement(sql) {
    // node:sqlite's prepared statements take values as arguments to
    // run/get/all — there is no .bind(). So we record the bind values
    // and pass them on each terminal call.
    let binds = null;
    function values() {
      return (binds && binds.length) ? binds : [];
    }
    const obj = {
      bind(...args) {
        binds = args;
        return {
          first() {
            const row = s.get(...values());
            return row || null;
          },
          all() {
            const rows = s.all(...values());
            return { results: rows, success: true, meta: { changes: 0, last_row_id: 0, rows_read: rows.length, rows_written: 0 } };
          },
          run() {
            const info = s.run(...values());
            return { success: true, meta: { changes: info.changes || 0, last_row_id: info.lastInsertRowid || 0, rows_read: 0, rows_written: info.changes || 0 } };
          }
        };
      },
      run() {
        const info = s.run(...values());
        return { success: true, meta: { changes: info.changes || 0, last_row_id: info.lastInsertRowid || 0, rows_read: 0, rows_written: info.changes || 0 } };
      }
    };
    const s = db.prepare(sql);
    return obj;
  }

  return {
    prepare(sql) { return makeStatement(sql); },
    async batch(stmts) {
      // D1's batch is sequential when awaited; emulate that.
      for (const stmt of stmts) {
        // The D1 docs say each entry is the value returned from .prepare(...).bind(...)
        // i.e. a statement that has had .bind() called. We just call .run() on it.
        // (Our db.* helpers only use .run()-able statements in batch.)
        if (stmt && typeof stmt.run === "function") {
          await stmt.run();
        } else if (stmt && typeof stmt.all === "function") {
          await stmt.all();
        } else if (stmt && typeof stmt.first === "function") {
          await stmt.first();
        }
      }
      return { success: true, meta: {} };
    }
  };
}
