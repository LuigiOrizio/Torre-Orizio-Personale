// Torre Orizio Personale — server minimo, senza dipendenze (Node 18+).
// Dati in file JSON su disco (DATA_DIR), allegati in DATA_DIR/assets, backup giornalieri in DATA_DIR/backups.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const PUBLIC_DIR = path.join(__dirname, "public");
const PASSPHRASE = process.env.PASSPHRASE || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const ANTHROPIC_WORKSPACE_ID = String(process.env.ANTHROPIC_WORKSPACE_ID || "").trim(); // chiavi utente (sk-ant-usr-…): Anthropic richiede l'ID dell'area di lavoro
const ANTHROPIC_BASE_URL = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
const SECURE_COOKIE = process.env.INSECURE_COOKIE !== "1"; // metti INSECURE_COOKIE=1 solo per prove in locale senza https
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 180);
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_DOC_BYTES = 256 * 1024;
const COLLS = ["argomenti", "impegni", "note", "lezioni", "obiettivi", "eventi", "giorni", "impostazioni"];

if (!PASSPHRASE || PASSPHRASE.length < 8) { console.error("Imposta la variabile PASSPHRASE (almeno 8 caratteri) prima di avviare."); process.exit(1); }
for (const d of [DATA_DIR, path.join(DATA_DIR, "assets"), path.join(DATA_DIR, "backups")]) fs.mkdirSync(d, { recursive: true });

// ---------- persistenza ----------
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESS_FILE = path.join(DATA_DIR, "sessions.json");
function readJson(f, def) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return def; } }
// Scrittura atomica e durevole: file temporaneo + fsync + rename + fsync della cartella. Chi chiama riceve la risposta solo dopo questa funzione.
function writeJsonAtomic(f, obj) { const tmp = f + ".tmp"; const fd = fs.openSync(tmp, "w"); try { fs.writeSync(fd, JSON.stringify(obj)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, f); try { const dfd = fs.openSync(path.dirname(f), "r"); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch (e) {} }
function writeFileDurable(f, buf) { const tmp = f + ".tmp"; const fd = fs.openSync(tmp, "w"); try { fs.writeSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, f); }
let db = readJson(DB_FILE, { seq: 0, docs: {} }); // docs: {"coll/id": {data, seq, deleted?}}
let sessions = readJson(SESS_FILE, {});
let sessDirty = false;
function markDb() { writeJsonAtomic(DB_FILE, db); }
setInterval(() => { if (sessDirty) { writeJsonAtomic(SESS_FILE, sessions); sessDirty = false; } }, 500).unref();
function flushNow() { if (sessDirty) { writeJsonAtomic(SESS_FILE, sessions); sessDirty = false; } }
process.on("SIGTERM", () => { flushNow(); process.exit(0); }); process.on("SIGINT", () => { flushNow(); process.exit(0); });
// Un errore imprevisto in una richiesta non deve fermare il server: viene registrato e la richiesta riceve 500.
process.on("uncaughtException", (e) => { console.error("errore non gestito", e); });
process.on("unhandledRejection", (e) => { console.error("promessa non gestita", e); });

// dati iniziali: se il database è vuoto, importa dati-iniziali.json (stesso formato del backup)
if (Object.keys(db.docs).length === 0) {
  const init = readJson(path.join(__dirname, "dati-iniziali.json"), null);
  if (init && typeof init === "object") {
    if (init.profilo) putDoc("impostazioni", "profilo", init.profilo);
    for (const c of COLLS) for (const d of (Array.isArray(init[c]) ? init[c] : [])) if (d && typeof d.id === "string") putDoc(c, d.id, d);
    flushNow(); console.log("Dati iniziali importati.");
  }
}
function putDoc(coll, id, data) { db.seq++; db.docs[coll + "/" + id] = { data, seq: db.seq }; markDb(); return db.seq; }
function delDoc(coll, id) { db.seq++; db.docs[coll + "/" + id] = { data: null, seq: db.seq, deleted: true }; markDb(); return db.seq; }
// Scrittura condizionale: va a buon fine solo se la versione attuale del documento è quella che il client ha visto (base). 0 = documento nuovo.
function putDocIfVersion(coll, id, data, base) { const cur = db.docs[coll + "/" + id]; const curSeq = cur && !cur.deleted ? cur.seq : 0; if (curSeq !== base) return { conflict: true, current: { exists: curSeq !== 0, data: curSeq ? cur.data : null, seq: curSeq } }; return { seq: putDoc(coll, id, data) }; }
const ASSET_INDEX = path.join(DATA_DIR, "assets", "index.json");
function assetMeta() { return readJson(ASSET_INDEX, {}); }
function backupSnapshot(withAssets) {
  const out = { formato: "torre-orizio-personale/1", esportato: new Date().toISOString(), profilo: null }; for (const c of COLLS) out[c] = [];
  for (const [k, v] of Object.entries(db.docs)) { if (v.deleted) continue; const i = k.indexOf("/"); const c = k.slice(0, i); const id = k.slice(i + 1); if (c === "impostazioni" && id === "profilo") out.profilo = v.data; else if (out[c]) out[c].push(Object.assign({ id }, v.data)); }
  if (withAssets) { out.allegati = []; const meta = assetMeta(); for (const [id, m] of Object.entries(meta)) { const f = path.join(DATA_DIR, "assets", id); if (fs.existsSync(f)) out.allegati.push({ id, type: m.type, nome: m.nome || "", base64: fs.readFileSync(f).toString("base64") }); } }
  return out;
}
// Ripristino: aggiunge i mancanti, aggiorna solo se il backup è più recente (campo `modificato`), non tocca i più recenti qui; scrive gli allegati con lo stesso id.
function restoreBackup(bk, modalita) {
  const r = { nuovi: 0, aggiornati: 0, saltati: 0, allegati: 0, allegati_esistenti: 0 };
  if (!bk || typeof bk !== "object" || !String(bk.formato || "").startsWith("torre-orizio-personale/")) return { error: "formato" };
  const docs = [];
  // Profilo: unione con quello esistente, in entrambe le modalità (mai sostituzione in blocco).
  if (bk.profilo && typeof bk.profilo === "object" && !Array.isArray(bk.profilo)) {
    const curP = db.docs["impostazioni/profilo"]; const curd = (curP && !curP.deleted && curP.data) ? curP.data : {};
    const p = Object.assign({}, curd, bk.profilo);
    const nuove = Array.isArray(bk.profilo.persone) ? bk.profilo.persone.filter(x => x && typeof x.nome === "string") : [];
    const nomi = new Set(nuove.map(x => x.nome.trim().toLowerCase()));
    p.persone = nuove.concat((Array.isArray(curd.persone) ? curd.persone : []).filter(x => x && typeof x.nome === "string" && !nomi.has(x.nome.trim().toLowerCase())));
    if (curd.max_azioni != null) p.max_azioni = curd.max_azioni;
    p.profilo_versioni = (Array.isArray(curd.profilo_versioni) ? curd.profilo_versioni : []).concat([{ quando: new Date().toISOString(), cosa: "Profilo unito con backup del " + (bk.esportato || "?"), persone_prima: (Array.isArray(curd.persone) ? curd.persone : []).length }]).slice(-20);
    putDoc("impostazioni", "profilo", p); r.profilo_persone = p.persone.length;
  }
  for (const c of COLLS) for (const d of (Array.isArray(bk[c]) ? bk[c] : [])) if (d && typeof d === "object" && typeof d.id === "string" && SAFE_ID.test(d.id)) { const dd = Object.assign({}, d); delete dd._pending; delete dd._readonly; docs.push([c, d.id, dd]); }
  for (const [c, id, d] of docs) {
    const cur = db.docs[c + "/" + id]; const exists = cur && !cur.deleted;
    if (!exists) { putDoc(c, id, d); r.nuovi++; continue; }
    const piuRecente = String(d.modificato || "") > String(cur.data.modificato || "");
    if (modalita === "tutti" && piuRecente) { const nd = Object.assign({}, d); nd.versioni = (cur.data.versioni || []).concat(d.versioni || []).concat([{ quando: new Date().toISOString(), cosa: "Ripristinato da backup del " + (bk.esportato || "?") }]); putDoc(c, id, nd); r.aggiornati++; } else r.saltati++;
  }
  if (Array.isArray(bk.allegati)) { const meta = assetMeta(); for (const a of bk.allegati) { if (!a || !/^[a-f0-9]{32}$/.test(String(a.id)) || typeof a.base64 !== "string") continue; const f = path.join(DATA_DIR, "assets", a.id); if (fs.existsSync(f)) { r.allegati_esistenti++; continue; } const buf = Buffer.from(a.base64, "base64"); if (!buf.length || buf.length > MAX_ASSET_BYTES) continue; writeFileDurable(f, buf); meta[a.id] = { type: String(a.type || "application/octet-stream"), size: buf.length, nome: String(a.nome || "").slice(0, 200), creato: new Date().toISOString() }; r.allegati++; } writeJsonAtomic(ASSET_INDEX, meta); }
  return r;
}
function dailyBackup() { try { const name = "backup-" + new Date().toISOString().slice(0, 10) + ".json"; const f = path.join(DATA_DIR, "backups", name); if (!fs.existsSync(f)) { writeJsonAtomic(f, backupSnapshot()); const files = fs.readdirSync(path.join(DATA_DIR, "backups")).filter(x => x.startsWith("backup-")).sort(); while (files.length > 30) fs.unlinkSync(path.join(DATA_DIR, "backups", files.shift())); } } catch (e) { console.error("backup", e); } }
setInterval(dailyBackup, 60 * 60 * 1000).unref(); setTimeout(dailyBackup, 5000).unref();

// ---------- autenticazione ----------
const SALT = crypto.createHash("sha256").update("torre-orizio-salt").digest();
const PASS_HASH = crypto.scryptSync(PASSPHRASE, SALT, 32);
const loginAttempts = new Map(); // ip -> {n, until}
function checkPass(p) { if (typeof p !== "string" || !p.length) return false; const h = crypto.scryptSync(p, SALT, 32); return crypto.timingSafeEqual(h, PASS_HASH); }
// Cookie malformati (percent-encoding rotto, caratteri strani) non devono mai far cadere il processo: valore ignorato.
function parseCookies(req) { const out = {}; String(req.headers.cookie || "").split(";").forEach(c => { const i = c.indexOf("="); if (i > 0) { let v = c.slice(i + 1).trim(); try { v = decodeURIComponent(v); } catch (e) { return; } out[c.slice(0, i).trim()] = v; } }); return out; }
function sessionOf(req) { let sid; try { sid = parseCookies(req).top_session; } catch (e) { return null; } if (typeof sid !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(sid)) return null; const s = Object.prototype.hasOwnProperty.call(sessions, sid) ? sessions[sid] : null; if (!s) return null; if (Date.now() > s.exp) { delete sessions[sid]; sessDirty = true; return null; } return s; }
function newSession(res) { const sid = crypto.randomBytes(32).toString("base64url"); sessions[sid] = { exp: Date.now() + SESSION_DAYS * 86400000, creato: new Date().toISOString() }; writeJsonAtomic(SESS_FILE, sessions); sessDirty = false; res.setHeader("Set-Cookie", `top_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${SECURE_COOKIE ? "; Secure" : ""}`); }
function clearSession(req, res) { const sid = parseCookies(req).top_session; if (sid) { delete sessions[sid]; writeJsonAtomic(SESS_FILE, sessions); sessDirty = false; } res.setHeader("Set-Cookie", `top_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE_COOKIE ? "; Secure" : ""}`); }
function ipOf(req) { return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?"; }

// ---------- utilità http ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function send(res, status, body, type, extra) { const h = Object.assign({ "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" }, extra || {}); res.writeHead(status, h); res.end(body); }
function json(res, status, obj) { send(res, status, JSON.stringify(obj)); }
function readBody(req, max) { return new Promise((resolve, reject) => { const chunks = []; let n = 0; req.on("data", c => { n += c.length; if (n > max) { reject(new Error("too_large")); req.destroy(); } else chunks.push(c); }); req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject); }); }
const SAFE_ID = /^[A-Za-z0-9_.~:@+-]{1,200}$/;
function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://cdnjs.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

// ---------- Coach (Anthropic Messages API, chiave solo sul server) ----------
async function coach(body) {
  if (!ANTHROPIC_API_KEY) return { error: "not_configured" };
  const input = body.input; const wantJson = !!body.json; const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
  let messages = [];
  if (typeof input === "string") messages = [{ role: "user", content: input }];
  else if (Array.isArray(input)) messages = input.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content).map(m => ({ role: m.role, content: m.content }));
  if (!messages.length) return { error: "invalid_request" };
  if (images.length) { const last = messages[messages.length - 1]; last.content = images.map(im => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })).concat([{ type: "text", text: typeof last.content === "string" ? last.content : "" }]); }
  const system = "Sei il Coach privato di Luigi Orizio dentro la sua app personale. Rispondi in italiano. " + (wantJson ? "Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza blocchi di codice. Dentro le stringhe usa \\n per andare a capo (mai a capo reali), niente virgole finali, niente commenti. Frasi brevi." : "");
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 170000);
  try {
    const r = await fetch(ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", signal: ctl.signal, headers: Object.assign({ "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": ANTHROPIC_WORKSPACE_ID } : {}), body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 8000, system, messages }) });
    const txt = await r.text();
    if (!r.ok) { console.error("anthropic", r.status, txt.slice(0, 300)); return { error: r.status === 429 ? "rate_limited" : r.status === 401 || r.status === 403 ? "not_configured" : "upstream_error", status: r.status }; }
    const data = JSON.parse(txt); const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim();
    if (!text) return { error: "empty_completion" };
    const out = { text, truncated: data.stop_reason === "max_tokens" };
    if (wantJson) { const v = parseJsonLenient(text); if (v === undefined) return { error: "invalid_json", text }; out.value = v; }
    return out;
  } catch (e) { return { error: e.name === "AbortError" ? "upstream_error" : "upstream_error", message: String(e.message || e) }; }
  finally { clearTimeout(timer); }
}
function ripara(s) { // a capo e tabulazioni dentro le stringhe → \\n; virgole finali tolte
  let out = "", inStr = false, esc = false;
  for (const ch of s) { if (inStr) { if (esc) { out += ch; esc = false; } else if (ch === "\\") { out += ch; esc = true; } else if (ch === '"') { out += ch; inStr = false; } else if (ch === "\n") out += "\\n"; else if (ch === "\r") {} else if (ch === "\t") out += "\\t"; else out += ch; } else { if (ch === '"') inStr = true; out += ch; } }
  return out.replace(/,\s*([}\]])/g, "$1");
}
function parseJsonLenient(t) {
  const tries = [];
  tries.push(t); const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) tries.push(m[1]);
  const a = t.search(/[\[{]/); const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]")); if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const c of tries) { try { return JSON.parse(c); } catch (e) {} try { return JSON.parse(ripara(c)); } catch (e) {} }
  return undefined;
}

// ---------- routing ----------
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, "http://x"); const p = url.pathname; const sess = sessionOf(req);
  try {
    // --- pubblico ---
    if (p === "/api/login" && req.method === "POST") {
      const ip = ipOf(req); const a = loginAttempts.get(ip) || { n: 0, until: 0 };
      if (Date.now() < a.until) return json(res, 429, { error: "too_many_attempts", retry_in_s: Math.ceil((a.until - Date.now()) / 1000) });
      let body = {}; try { body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}"); } catch (e) {}
      if (checkPass(body.passphrase)) { loginAttempts.delete(ip); newSession(res); return json(res, 200, { ok: true }); }
      a.n++; if (a.n >= 5) { a.until = Date.now() + 15 * 60000; a.n = 0; } loginAttempts.set(ip, a);
      return json(res, 401, { error: "wrong_passphrase" });
    }
    if (p === "/api/logout" && req.method === "POST") { clearSession(req, res); return json(res, 200, { ok: true }); }
    if (p === "/login.html" || p === "/manifest.webmanifest" || p === "/sw.js" || p.startsWith("/icons/") || p === "/login.js") return serveStatic(res, p);
    if (p === "/api/me") return json(res, sess ? 200 : 401, sess ? { ok: true, coach: !!ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL } : { error: "unauthorized" });
    // --- tutto il resto richiede la sessione ---
    if (!sess) { if (p === "/" || p === "/index.html") { res.writeHead(302, { Location: "/login.html" }); return res.end(); } return json(res, 401, { error: "unauthorized" }); }
    if (p === "/" || p === "/index.html") return serveStatic(res, "/index.html");
    if (p === "/app.js" || p === "/platform.js") return serveStatic(res, p);

    if (p === "/api/changes" && req.method === "GET") { const since = Number(url.searchParams.get("since") || 0); const changes = []; for (const [k, v] of Object.entries(db.docs)) if (v.seq > since) { const i = k.indexOf("/"); changes.push({ coll: k.slice(0, i), id: k.slice(i + 1), seq: v.seq, deleted: !!v.deleted, data: v.deleted ? null : v.data }); } changes.sort((a, b) => a.seq - b.seq); return json(res, 200, { seq: db.seq, changes }); }
    const mDoc = p.match(/^\/api\/doc\/([a-z]+)\/([^/]+)$/);
    if (mDoc) {
      const coll = mDoc[1]; const id = decodeURIComponent(mDoc[2]); if (!COLLS.includes(coll) || !SAFE_ID.test(id)) return json(res, 400, { error: "invalid_argument" });
      const key = coll + "/" + id;
      if (req.method === "GET") { const v = db.docs[key]; return json(res, 200, { exists: !!(v && !v.deleted), data: v && !v.deleted ? v.data : null, seq: v ? v.seq : 0 }); }
      if (req.method === "PUT") {
        let body; try { body = JSON.parse((await readBody(req, MAX_DOC_BYTES + 1024)).toString("utf8")); } catch (e) { return json(res, e.message === "too_large" ? 413 : 400, { error: e.message === "too_large" ? "too_large" : "invalid_argument" }); }
        if (!body || typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) return json(res, 400, { error: "invalid_argument" });
        // `base` = versione (seq) che il client ha letto; 0 per un documento nuovo. Senza `base` (o con force) si sovrascrive esplicitamente.
        if (body.force === true || body.base === undefined) { const seq = putDoc(coll, id, body.data); return json(res, 200, { ok: true, seq, forced: body.force === true }); }
        const base = Number(body.base); if (!Number.isInteger(base) || base < 0) return json(res, 400, { error: "invalid_argument" });
        const r = putDocIfVersion(coll, id, body.data, base);
        if (r.conflict) return json(res, 409, { error: "conflict", current: r.current });
        return json(res, 200, { ok: true, seq: r.seq });
      }
      if (req.method === "DELETE") { const seq = delDoc(coll, id); return json(res, 200, { ok: true, seq }); }
    }
    if (p === "/api/coach" && req.method === "POST") { let body; try { body = JSON.parse((await readBody(req, 6 * 1024 * 1024)).toString("utf8")); } catch (e) { return json(res, 400, { error: "invalid_request" }); } const r = await coach(body); return json(res, r.error ? 502 : 200, r); }
    if (p === "/api/assets" && req.method === "POST") {
      const type = (req.headers["content-type"] || "").split(";")[0].trim(); const ok = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/markdown", "application/json", "text/csv"];
      if (!ok.includes(type)) return json(res, 415, { error: "unsupported_type" });
      let buf; try { buf = await readBody(req, MAX_ASSET_BYTES); } catch (e) { return json(res, 413, { error: "too_large" }); } if (!buf.length) return json(res, 400, { error: "invalid_request" });
      const id = crypto.randomBytes(16).toString("hex"); writeFileDurable(path.join(DATA_DIR, "assets", id), buf); const meta = readJson(path.join(DATA_DIR, "assets", "index.json"), {}); meta[id] = { type, size: buf.length, nome: String(req.headers["x-filename"] || "").slice(0, 200), creato: new Date().toISOString() }; writeJsonAtomic(path.join(DATA_DIR, "assets", "index.json"), meta);
      return json(res, 200, { id, url: "/_blob/" + id, sizeBytes: buf.length, contentType: type });
    }
    if (p === "/api/assets" && req.method === "GET") { const meta = readJson(path.join(DATA_DIR, "assets", "index.json"), {}); let bytes = 0; const assets = Object.entries(meta).map(([id, m]) => { bytes += m.size; return { id, url: "/_blob/" + id, contentType: m.type, sizeBytes: m.size, createdAt: m.creato }; }); return json(res, 200, { assets, usage: { files: assets.length, bytes, maxFiles: 10000, maxBytes: 10 * 1024 * 1024 * 1024 } }); }
    const mAsset = p.match(/^\/(?:_blob|api\/assets)\/([a-f0-9]{32})$/);
    if (mAsset) {
      const id = mAsset[1]; const f = path.join(DATA_DIR, "assets", id); const meta = readJson(path.join(DATA_DIR, "assets", "index.json"), {});
      if (req.method === "DELETE") { const existed = fs.existsSync(f); if (existed) fs.unlinkSync(f); delete meta[id]; writeJsonAtomic(path.join(DATA_DIR, "assets", "index.json"), meta); return json(res, 200, { deleted: existed }); }
      if (!fs.existsSync(f) || !meta[id]) return json(res, 404, { error: "not_found" });
      res.writeHead(200, { "Content-Type": meta[id].type, "Content-Length": meta[id].size, "Cache-Control": "private, max-age=3600", "Content-Disposition": "inline; filename=\"" + (meta[id].nome || id).replace(/[^\w.-]/g, "_") + "\"" }); return fs.createReadStream(f).pipe(res);
    }
    if (p === "/api/backup" && req.method === "GET") { const withAssets = url.searchParams.get("allegati") !== "0"; return send(res, 200, JSON.stringify(backupSnapshot(withAssets)), "application/json; charset=utf-8", { "Content-Disposition": "attachment; filename=\"torre-orizio-personale-" + new Date().toISOString().slice(0, 10) + ".json\"" }); }
    if (p === "/api/restore" && req.method === "POST") {
      let body; try { body = JSON.parse((await readBody(req, 200 * 1024 * 1024)).toString("utf8")); } catch (e) { return json(res, e.message === "too_large" ? 413 : 400, { error: e.message === "too_large" ? "too_large" : "invalid_request" }); }
      const modalita = url.searchParams.get("modalita") === "tutti" ? "tutti" : "mancanti";
      if (url.searchParams.get("anteprima") === "1") { // solo il piano, senza scrivere nulla
        const bk = body; if (!bk || !String(bk.formato || "").startsWith("torre-orizio-personale/")) return json(res, 400, { error: "formato" });
        const piano = { nuovi: 0, backupPiuRecenti: 0, quiPiuRecenti: 0, uguali: 0, allegati: Array.isArray(bk.allegati) ? bk.allegati.length : 0 };
        for (const c of COLLS) for (const d of (Array.isArray(bk[c]) ? bk[c] : [])) { if (!d || typeof d.id !== "string") continue; const cur = db.docs[c + "/" + d.id]; if (!cur || cur.deleted) piano.nuovi++; else { const a = String(d.modificato || ""), b = String(cur.data.modificato || ""); if (a > b) piano.backupPiuRecenti++; else if (a === b) piano.uguali++; else piano.quiPiuRecenti++; } }
        return json(res, 200, piano);
      }
      const r = restoreBackup(body, modalita); if (r.error) return json(res, 400, r); return json(res, 200, r);
    }
    return json(res, 404, { error: "not_found" });
  } catch (e) { console.error(e); return json(res, 500, { error: "server_error" }); }
});
function serveStatic(res, p) { const f = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, "")); if (!f.startsWith(PUBLIC_DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return json(res, 404, { error: "not_found" }); const ext = path.extname(f); res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".html" || p === "/sw.js" ? "no-cache" : "public, max-age=86400" }); fs.createReadStream(f).pipe(res); }
server.listen(PORT, () => console.log(`Torre Orizio Personale in ascolto sulla porta ${PORT} · dati in ${DATA_DIR} · Coach ${ANTHROPIC_API_KEY ? "configurato (" + ANTHROPIC_MODEL + ")" : "NON configurato: manca ANTHROPIC_API_KEY"}`));
