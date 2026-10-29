// A deliberately small, quote-aware SQL structure checker for OUR migration style. It is NOT a PostgreSQL parser and
// cannot prove the SQL executes; tests/backend/integration/db.integration.test.js does that when a database is available.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function stripComments(sql) { return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, ''); }

/** Splits on commas at parenthesis depth 0, ignoring anything inside '...' strings. */
export function splitTop(text) {
  const out = []; let depth = 0; let cur = ''; let q = false;
  for (const ch of text) {
    if (ch === "'") q = !q;
    if (!q) { if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; } }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function balanced(text, openIdx) {
  let depth = 0; let q = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") q = !q;
    if (q) continue;
    if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  throw new Error('Unbalanced parentheses');
}
const idents = (s) => (s.match(/[a-z_][a-z0-9_]*/gi) || []).map((x) => x.toLowerCase());

export function parseSchema(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const tables = new Map(); const indexes = []; const triggers = []; const problems = [];
  for (const f of files) {
    const sql = stripComments(readFileSync(path.join(migrationsDir, f), 'utf8'));
    for (const m of sql.matchAll(/CREATE TABLE\s+(\w+)\s*\(/gi)) {
      const name = m[1].toLowerCase(); const open = m.index + m[0].length - 1;
      const body = sql.slice(open + 1, balanced(sql, open));
      const t = { name, file: f, columns: new Map(), pk: [], uniques: [], fks: [], constraints: [] };
      for (const item of splitTop(body)) {
        const up = item.toUpperCase();
        if (/^(CONSTRAINT\s+\w+\s+)?PRIMARY KEY/i.test(item)) t.pk = idents(item.match(/\(([^)]*)\)/)[1]);
        else if (/^(CONSTRAINT\s+\w+\s+)?UNIQUE\s*\(/i.test(item)) t.uniques.push(idents(item.match(/\(([^)]*)\)/)[1]));
        else if (/^CONSTRAINT\s+\w+\s+CHECK/i.test(item)) t.constraints.push(item.split(/\s+/)[1].toLowerCase());
        else if (/^(CONSTRAINT\s+\w+\s+)?FOREIGN KEY/i.test(item)) problems.push(`${name}: use column-level REFERENCES for consistency`);
        else {
          const col = item.split(/\s+/)[0].toLowerCase(); t.columns.set(col, item);
          if (/PRIMARY KEY/.test(up)) t.pk = [col];
          if (/\bUNIQUE\b/.test(up)) t.uniques.push([col]);
          const r = /REFERENCES\s+(\w+)\s*\((\w+)\)(.*)$/i.exec(item);
          if (r) t.fks.push({ column: col, table: r[1].toLowerCase(), refColumn: r[2].toLowerCase(), rest: r[3] });
        }
      }
      if (tables.has(name)) problems.push(`duplicate table ${name}`);
      tables.set(name, t);
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)\s+([^;]*);/gi)) {
      const t = tables.get(m[1].toLowerCase()); if (!t) { problems.push(`${f}: ALTER of unknown table ${m[1]}`); continue; }
      t.columns.set(m[2].toLowerCase(), `${m[2]} ${m[3]}`);
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD CONSTRAINT\s+(\w+)\s+CHECK/gi)) tables.get(m[1].toLowerCase())?.constraints.push(m[2].toLowerCase());
    for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(\w+)\s+ON\s+(\w+)(?:\s+USING\s+\w+)?\s*\(/gi)) {
      const open = m.index + m[0].length - 1;
      indexes.push({ name: m[2].toLowerCase(), table: m[3].toLowerCase(), unique: !!m[1], items: splitTop(sql.slice(open + 1, balanced(sql, open))), file: f });
    }
    for (const m of sql.matchAll(/CREATE TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+([A-Z ]+?)\s+ON\s+(\w+)[\s\S]*?EXECUTE FUNCTION\s+(\w+)/gi)) {
      triggers.push({ name: m[1].toLowerCase(), when: m[2].toUpperCase(), events: m[3].toUpperCase(), table: m[4].toLowerCase(), fn: m[5].toLowerCase() });
    }
    if (/CONCURRENTLY/i.test(sql)) problems.push(`${f}: CONCURRENTLY cannot run inside the migration transaction`);
    if (/^\s*(BEGIN\s*;|BEGIN\s+TRANSACTION|START\s+TRANSACTION|COMMIT\s*;|ROLLBACK\s*;)/im.test(sql)) problems.push(`${f}: do not manage transactions inside a migration file`);
  }
  return { tables, indexes, triggers, problems };
}

export function lintSchema({ tables, indexes, triggers, problems }) {
  const out = [...problems];
  const indexLeads = (table) => [
    ...indexes.filter((i) => i.table === table).map((i) => idents(i.items[0])[0] === 'lower' ? idents(i.items[0])[1] : idents(i.items[0])[0]),
    tables.get(table).pk[0], ...tables.get(table).uniques.map((u) => u[0]),
  ];
  for (const t of tables.values()) {
    if (!t.pk.length) out.push(`${t.name}: no primary key`);
    for (const c of t.pk) if (!t.columns.has(c)) out.push(`${t.name}: primary key column ${c} does not exist`);
    for (const fk of t.fks) {
      const target = tables.get(fk.table);
      if (!target) { out.push(`${t.name}.${fk.column}: references unknown table ${fk.table}`); continue; }
      if (target.file > t.file || (target.file === t.file && [...tables.keys()].indexOf(fk.table) > [...tables.keys()].indexOf(t.name))) out.push(`${t.name}.${fk.column}: references ${fk.table} which is created later`);
      const refOk = (target.pk.length === 1 && target.pk[0] === fk.refColumn) || target.uniques.some((u) => u.length === 1 && u[0] === fk.refColumn);
      if (!refOk) out.push(`${t.name}.${fk.column}: ${fk.table}.${fk.refColumn} is not a single-column primary/unique key`);
      if (!/ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION)/i.test(fk.rest)) out.push(`${t.name}.${fk.column}: missing explicit ON DELETE behaviour`);
      if (/ON DELETE SET NULL/i.test(fk.rest) && /\bNOT NULL\b/i.test(t.columns.get(fk.column))) out.push(`${t.name}.${fk.column}: SET NULL on a NOT NULL column`);
      if (!indexLeads(t.name).includes(fk.column)) out.push(`${t.name}.${fk.column}: foreign key has no index starting with it`);
    }
    if (t.columns.has('updated_at') && !triggers.some((g) => g.table === t.name && g.fn === 'set_updated_at' && g.when === 'BEFORE' && g.events.includes('UPDATE'))) out.push(`${t.name}: has updated_at but no set_updated_at trigger`);
  }
  for (const i of indexes) {
    const t = tables.get(i.table);
    if (!t) { out.push(`index ${i.name}: unknown table ${i.table}`); continue; }
    for (const item of i.items) for (const id of idents(item)) if (!['lower', 'desc', 'asc', 'nulls', 'first', 'last'].includes(id) && !t.columns.has(id)) out.push(`index ${i.name}: ${i.table} has no column ${id}`);
  }
  const names = new Set(); for (const i of indexes) { if (names.has(i.name)) out.push(`duplicate index name ${i.name}`); names.add(i.name); }
  return out;
}

/** Checks INSERT INTO x (cols) statements in a seed file against the parsed schema. */
export function lintInserts(sql, tables) {
  const out = [];
  for (const m of stripComments(sql).matchAll(/INSERT INTO\s+(\w+)\s*\(([^)]*)\)/gi)) {
    const t = tables.get(m[1].toLowerCase());
    if (!t) { out.push(`seed inserts into unknown table ${m[1]}`); continue; }
    for (const c of m[2].split(',').map((x) => x.trim().toLowerCase())) if (!t.columns.has(c)) out.push(`seed: ${t.name} has no column ${c}`);
  }
  return out;
}
