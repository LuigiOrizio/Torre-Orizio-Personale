// Adattatore: espone window.claude.use(...) come nel viewer di claude.ai, ma parla con il server di Torre Orizio Personale.
(() => {
  "use strict";
  const COLLS = ["argomenti", "impegni", "note", "lezioni", "obiettivi", "eventi", "giorni", "impostazioni"];
  const cache = new Map(); // coll -> Map(id -> data)
  const vers = new Map();  // "coll/id" -> seq (versione del documento come l'ha vista questo client)
  for (const c of COLLS) cache.set(c, new Map());
  let seq = 0, serverFresh = false, loaded = false, polling = null, pollDelay = 4000;
  const collListeners = new Map(); // coll -> Set(fn)
  const docListeners = new Map();  // "coll/id" -> Set(fn)
  let me = null;

  const api = async (method, url, body, headers) => {
    const r = await fetch(url, { method, headers: Object.assign(body && !(body instanceof Blob) ? { "content-type": "application/json" } : {}, headers || {}), body: body ? (body instanceof Blob ? body : JSON.stringify(body)) : undefined, credentials: "same-origin" });
    if (r.status === 401) { location.href = "/login.html"; throw { code: "revoked", message: "sessione scaduta" }; }
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw Object.assign({ code: (data && data.error) || "unavailable", message: "HTTP " + r.status }, data || {});
    return data;
  };
  const snapOf = (coll, id, d) => ({ id, exists: d != null, seq: vers.get(coll + "/" + id) || 0, data: () => d == null ? undefined : JSON.parse(JSON.stringify(d)), metadata: { fromCache: !serverFresh, hasPendingWrites: false } });
  const emitColl = (coll) => { const m = cache.get(coll); const docs = Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([id, d]) => snapOf(coll, id, d)); for (const fn of (collListeners.get(coll) || [])) { try { fn({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: !serverFresh, hasPendingWrites: false } }); } catch (e) { console.error(e); } } };
  const emitDoc = (coll, id) => { for (const fn of (docListeners.get(coll + "/" + id) || [])) { try { fn(snapOf(coll, id, cache.get(coll).get(id) ?? null)); } catch (e) { console.error(e); } } };
  async function poll() {
    try {
      const r = await api("GET", "/api/changes?since=" + seq);
      const touched = new Set();
      for (const c of r.changes) { if (!cache.has(c.coll)) continue; if (c.deleted) { cache.get(c.coll).delete(c.id); vers.delete(c.coll + "/" + c.id); } else { cache.get(c.coll).set(c.id, c.data); vers.set(c.coll + "/" + c.id, c.seq); } touched.add(c.coll); emitDoc(c.coll, c.id); }
      seq = r.seq; const wasFresh = serverFresh; serverFresh = true; loaded = true; pollDelay = 4000;
      if (!wasFresh) for (const c of COLLS) emitColl(c); else for (const c of touched) emitColl(c);
    } catch (e) { if (serverFresh) { serverFresh = false; for (const c of COLLS) emitColl(c); } pollDelay = Math.min(30000, pollDelay * 1.5); }
    clearTimeout(polling); polling = setTimeout(poll, document.visibilityState === "visible" ? pollDelay : 30000);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { clearTimeout(polling); poll(); } });
  window.addEventListener("online", () => { clearTimeout(polling); poll(); });

  const docRef = (coll, id) => ({
    id, path: coll + "/" + id,
    get: async () => { const r = await api("GET", "/api/doc/" + coll + "/" + encodeURIComponent(id)); if (r.exists) { cache.get(coll).set(id, r.data); vers.set(coll + "/" + id, r.seq); } else { vers.set(coll + "/" + id, 0); } return snapOf(coll, id, r.exists ? r.data : null); },
    // Scrittura condizionale: il server accetta solo se la versione è ancora quella letta da questo client; altrimenti 409 → {code:"conflict", current}.
    set: async (data, o) => {
      const k = coll + "/" + id; const base = vers.has(k) ? vers.get(k) : 0;
      let r; try { r = await api("PUT", "/api/doc/" + coll + "/" + encodeURIComponent(id), o && o.force ? { data, force: true } : { data, base }); }
      catch (e) { if (e.code === "conflict" && e.current) { if (e.current.exists) { cache.get(coll).set(id, e.current.data); vers.set(k, e.current.seq); } throw { code: "conflict", message: "modificato altrove", current: e.current }; } throw e; }
      cache.get(coll).set(id, JSON.parse(JSON.stringify(data))); vers.set(k, r.seq); emitDoc(coll, id); emitColl(coll); clearTimeout(polling); polling = setTimeout(poll, 300);
    },
    update: async (data) => { const cur = cache.get(coll).get(id); if (!cur) throw { code: "invalid_argument", message: "documento assente" }; await docRef(coll, id).set(Object.assign({}, cur, data)); },
    delete: async () => { await api("DELETE", "/api/doc/" + coll + "/" + encodeURIComponent(id)); cache.get(coll).delete(id); vers.delete(coll + "/" + id); emitDoc(coll, id); emitColl(coll); },
    onSnapshot: (fn) => { const k = coll + "/" + id; if (!docListeners.has(k)) docListeners.set(k, new Set()); docListeners.get(k).add(fn); if (loaded) setTimeout(() => emitDoc(coll, id), 0); return () => docListeners.get(k).delete(fn); },
    collection: () => { throw new TypeError("sottocollezioni non supportate"); },
  });
  const collRef = (coll) => ({ path: coll, doc: (id) => docRef(coll, id || ("g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))), onSnapshot: (fn) => { if (!collListeners.has(coll)) collListeners.set(coll, new Set()); collListeners.get(coll).add(fn); if (loaded) setTimeout(() => emitColl(coll), 0); return () => collListeners.get(coll).delete(fn); }, get: async () => ({ docs: [] }) });
  const dbApi = { doc: (p) => { const [c, id] = p.split("/"); if (!COLLS.includes(c) || !id) throw new TypeError("percorso non valido: " + p); return docRef(c, id); }, collection: (c) => { if (!COLLS.includes(c)) throw new TypeError("collezione non valida: " + c); return collRef(c); } };

  const toB64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  const sample = async (input, opts) => {
    opts = opts || {}; let images = [];
    if (opts.images) { const list = opts.images instanceof Blob ? [opts.images] : Array.from(opts.images); for (const b of list) images.push({ media_type: b.type || "image/jpeg", data: await toB64(b) }); }
    let r; try { r = await api("POST", "/api/coach", { input, json: false, images }); } catch (e) { throw { code: e.code === "not_configured" ? "sampling_disabled" : e.code || "upstream_error", message: e.message || "" }; }
    if (opts.onText) { try { opts.onText({ text: r.text, delta: r.text }); } catch (e) {} }
    return { text: r.text, truncated: !!r.truncated, modelTierApplied: "default" };
  };
  sample.json = async (input, opts) => {
    opts = opts || {}; let images = [];
    if (opts.images) { const list = opts.images instanceof Blob ? [opts.images] : Array.from(opts.images); for (const b of list) images.push({ media_type: b.type || "image/jpeg", data: await toB64(b) }); }
    let r; try { r = await api("POST", "/api/coach", { input, json: true, images }); } catch (e) { throw { code: e.code === "not_configured" ? "sampling_disabled" : e.code || "upstream_error", message: e.message || "", text: e.text }; }
    return r.value;
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 4, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } });

  const assets = {
    upload: async (blob, o) => api("POST", "/api/assets", blob, { "content-type": (o && o.type) || blob.type || "application/octet-stream", "x-filename": blob.name || "" }),
    list: async () => api("GET", "/api/assets"),
    delete: async (ref) => api("DELETE", "/api/assets/" + String(ref).replace("/_blob/", "")),
    // Ripristino lato server di un backup completo (documenti + allegati con gli stessi id). anteprima=true non scrive nulla.
    restore: async (backup, modalita, anteprima) => { const r = await api("POST", "/api/restore?modalita=" + (modalita === "tutti" ? "tutti" : "mancanti") + (anteprima ? "&anteprima=1" : ""), backup); if (!anteprima) { clearTimeout(polling); await poll(); } return r; },
  };
  const downloads = { save: async ({ filename, data }) => { const blob = data instanceof Blob ? data : new Blob([data]); const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 10000); return { status: "saved" }; } };
  const user = { isOwner: async () => true, canEdit: async () => true, can: async () => true, id: async () => "owner", me: async () => ({ id: "owner", name: "" }), profiles: async () => ({}) };

  const ready = (async () => { try { me = await api("GET", "/api/me"); } catch (e) { me = null; } if (me) { poll(); } })();
  window.claude = { use: async (name) => { await ready; if (!me) return null; return { db: dbApi, user, sample: me.coach ? sample : null, assets, downloads }[name] || null; } };

  // service worker (per l'icona sul telefono e l'apertura senza rete)
  if ("serviceWorker" in navigator) { window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); }); }
  // pulsante "Esci" e avviso Coach non configurato, dentro Impostazioni
  window.addEventListener("load", async () => {
    await ready; const box = document.querySelector("#impostazioni .inner"); if (!box) return;
    const row = document.createElement("div"); row.className = "row";
    const b = document.createElement("button"); b.className = "small"; b.textContent = "Esci da questo dispositivo"; b.addEventListener("click", async () => { try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch (e) {} location.href = "/login.html"; }); row.appendChild(b);
    const info = document.createElement("span"); info.className = "tiny"; info.textContent = me && me.coach ? "Coach: configurato (" + me.model + ")" : "Coach: non configurato sul server (manca la chiave API)"; row.appendChild(info);
    box.appendChild(row);
  });
})();
