// Torre Orizio Personale — platform.js (v9): adattatore tra la pagina (nata su claude.ai) e questo server.
// Espone `claude.use(nome)` per: db (documenti con versioni e conflitti), user, sample (Coach via /api/coach), assets (allegati, ripristino), downloads.
// Nessuna chiave nel browser. Le modifiche degli altri dispositivi arrivano con un polling leggero di /api/changes.
(() => {
  "use strict";
  const POLL_MS = 5000;
  const seqDi = new Map(); // "coll/id" -> versione (seq) vista
  const docs = new Map();  // "coll/id" -> data (copia locale allineata al server)
  const ascoltatori = new Map(); // coll -> [fn]
  const ascoltatoriDoc = new Map(); // "coll/id" -> [fn]
  let ultimoSeq = 0, primaLettura = false, pollTimer = null, inPoll = false, info = null;
  const err = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
  async function api(path, opts) {
    opts = opts || {}; const r = await fetch(path, Object.assign({ credentials: "same-origin" }, opts, opts.body && typeof opts.body !== "string" && !(opts.body instanceof Blob) ? { body: JSON.stringify(opts.body), headers: Object.assign({ "content-type": "application/json" }, opts.headers || {}) } : {}));
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (r.status === 401) { location.href = "/login.html"; throw err("unauthorized"); }
    if (!r.ok) throw err((j && j.error) || ("http_" + r.status), { status: r.status, current: j && j.current, message: j && j.message });
    return j;
  }
  function notifica(coll) { for (const fn of ascoltatori.get(coll) || []) { try { fn(snapshot(coll)); } catch (e) { console.error(e); } } }
  function notificaDoc(key) { for (const fn of ascoltatoriDoc.get(key) || []) { try { const d = docs.get(key); fn({ exists: d !== undefined, data: () => d, id: key.split("/")[1] }); } catch (e) { console.error(e); } } }
  function snapshot(coll) { const out = []; for (const [k, v] of docs) if (k.startsWith(coll + "/")) out.push({ id: k.slice(coll.length + 1), exists: true, data: () => v }); return { docs: out, metadata: { fromCache: !primaLettura } }; }
  function applica(ch) { const key = ch.coll + "/" + ch.id; if ((seqDi.get(key) || 0) > ch.seq) return false; seqDi.set(key, ch.seq); if (ch.deleted) docs.delete(key); else docs.set(key, ch.data); return true; }
  async function aggiorna() { // legge le modifiche dal server e avvisa chi ascolta
    if (inPoll) return; inPoll = true;
    try { const r = await api("/api/changes?since=" + ultimoSeq); const toccati = new Set(); const toccatiDoc = new Set(); for (const ch of r.changes || []) { if (applica(ch)) { toccati.add(ch.coll); toccatiDoc.add(ch.coll + "/" + ch.id); } } ultimoSeq = Math.max(ultimoSeq, r.seq || 0); const prima = !primaLettura; primaLettura = true; if (prima) for (const c of ascoltatori.keys()) toccati.add(c); for (const c of toccati) notifica(c); for (const k of toccatiDoc) notificaDoc(k); }
    catch (e) { if (e.code !== "unauthorized") console.warn("changes", e.code || e); }
    finally { inPoll = false; }
  }
  function avviaPoll() { if (pollTimer) return; const tick = () => { pollTimer = setTimeout(async () => { if (!document.hidden) await aggiorna(); tick(); }, POLL_MS); }; tick(); document.addEventListener("visibilitychange", () => { if (!document.hidden) aggiorna(); }); window.addEventListener("online", aggiorna); }
  const db = {
    collection(coll) {
      return {
        doc(id) { return docRef(coll, id); },
        onSnapshot(fn, onErr) { if (!ascoltatori.has(coll)) ascoltatori.set(coll, []); ascoltatori.get(coll).push(fn); if (primaLettura) fn(snapshot(coll)); return () => { const l = ascoltatori.get(coll) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; },
      };
    },
    doc(path) { const i = path.indexOf("/"); return docRef(path.slice(0, i), path.slice(i + 1)); },
    async versioni() { await aggiorna(); return { vers: new Map(seqDi), seq: ultimoSeq }; },
  };
  function docRef(coll, id) {
    const key = coll + "/" + id;
    return {
      async get() { const r = await api("/api/doc/" + coll + "/" + encodeURIComponent(id)); seqDi.set(key, r.seq || 0); if (r.exists) docs.set(key, r.data); else docs.delete(key); return { exists: !!r.exists, seq: r.seq || 0, id, data: () => r.data }; },
      async set(data, opts) { // base = versione vista; il server rifiuta (409) se nel frattempo è cambiata; con force si sovrascrive esplicitamente
        const body = { data }; if (opts && opts.force) body.force = true; else body.base = seqDi.has(key) ? seqDi.get(key) : 0;
        try { const r = await api("/api/doc/" + coll + "/" + encodeURIComponent(id), { method: "PUT", body }); seqDi.set(key, r.seq); docs.set(key, data); notificaDoc(key); aggiorna().catch(() => {}); return r; } // il cursore globale NON avanza qui: modifiche di altri dispositivi con seq più basso non devono essere saltate
        catch (e) { if (e.code === "conflict") { const cur = e.current || {}; seqDi.set(key, cur.seq || 0); if (cur.exists) docs.set(key, cur.data); else docs.delete(key); throw err("conflict", { current: cur }); } throw e; }
      },
      async delete() { const r = await api("/api/doc/" + coll + "/" + encodeURIComponent(id), { method: "DELETE" }); docs.delete(key); seqDi.set(key, r.seq); aggiorna().catch(() => {}); return r; },
      onSnapshot(fn, onErr) { if (!ascoltatoriDoc.has(key)) ascoltatoriDoc.set(key, []); ascoltatoriDoc.get(key).push(fn); if (primaLettura) notificaDoc(key); return () => {}; },
    };
  }
  const user = { async isOwner() { return true; }, id: "proprietario" };
  const fileToB64 = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(file); });
  async function sample(prompt, opts) { // Coach: la chiave resta sul server
    opts = opts || {}; const body = { input: prompt, json: !!opts.json };
    if (opts.images) { const list = Array.isArray(opts.images) ? opts.images : [opts.images]; body.images = []; for (const im of list.slice(0, 4)) body.images.push({ media_type: im.type || "image/jpeg", data: await fileToB64(im) }); }
    if (opts.signal && opts.signal.aborted) throw err("cancelled");
    let r; try { r = await api("/api/coach", { method: "POST", body, signal: opts.signal }); } catch (e) { if (e.name === "AbortError") throw err("cancelled"); throw e; }
    if (r.error) throw err(r.error, { text: r.text });
    return r;
  }
  sample.json = async (prompt, opts) => { const r = await sample(prompt, Object.assign({}, opts || {}, { json: true })); return r.value; };
  const assets = {
    async upload(file) { const r = await fetch("/api/assets", { method: "POST", credentials: "same-origin", headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name || "") }, body: file }); const j = await r.json().catch(() => ({})); if (!r.ok) throw err(j.error || "upload_failed"); return j; },
    async delete(id) { return api("/api/assets/" + id, { method: "DELETE" }); },
    async list() { return api("/api/assets"); },
    async restore(data, modalita, anteprima) { return api("/api/restore?modalita=" + encodeURIComponent(modalita || "mancanti") + (anteprima ? "&anteprima=1" : ""), { method: "POST", body: data }); },
  };
  const downloads = { async save(o) { const blob = new Blob([o.data], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = o.filename || "backup.json"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return { status: "saved" }; } };
  async function leggiInfo() { if (info) return info; try { info = await api("/api/me"); } catch (e) { info = { ok: false, coach: false, servizi: {} }; } return info; }
  window.claude = {
    async use(nome) {
      const i = await leggiInfo();
      if (nome === "db") { if (!primaLettura) await aggiorna(); avviaPoll(); return db; }
      if (nome === "user") return user;
      if (nome === "sample") return i.coach ? sample : null;
      if (nome === "assets") return assets;
      if (nome === "downloads") return downloads;
      return null;
    },
    info: leggiInfo,
    async logout() { await api("/api/logout", { method: "POST" }); location.href = "/login.html"; },
  };
})();
