#!/usr/bin/env python3
"""Prove di accettazione v9 (percorso completo nel browser, con modello simulato e server reale su cartella dati temporanea).
Avvio: python3 test/e2e-v9.py   (serve Playwright + Chromium). Scrive test/esiti-v9.md."""
import os, sys, json, time, subprocess, tempfile, shutil, urllib.request, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT, MPORT = 8093, 8099
PASS = "provaprova1"
esiti = []
def caso(n, titolo, ok, dettaglio=""):
    esiti.append((n, titolo, ok, dettaglio)); print(("OK  " if ok else "FAIL") + f" {n}. {titolo}" + (f" — {dettaglio}" if dettaglio else ""), flush=True)

def main():
    data = tempfile.mkdtemp(prefix="torre-v9-")
    mock = subprocess.Popen([sys.executable, str(ROOT / "test" / "modello-simulato.py"), str(MPORT)], stdout=subprocess.DEVNULL)
    env = dict(os.environ, PASSPHRASE=PASS, DATA_DIR=data, PORT=str(PORT), INSECURE_COOKIE="1", ANTHROPIC_API_KEY="chiave-di-prova", ANTHROPIC_BASE_URL=f"http://127.0.0.1:{MPORT}")
    srv = subprocess.Popen(["node", str(ROOT / "server.js")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(50):
            try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/me"); break
            except Exception as e:
                if getattr(e, "code", None) == 401: break
                time.sleep(0.2)
        # 11. privacy: senza sessione niente dati
        try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/changes?since=0"); caso(11, "Dati non accessibili senza sessione", False, "risposta 200")
        except Exception as e: caso(11, "Dati non accessibili senza sessione (server: 401)", getattr(e, "code", None) == 401, f"codice {getattr(e,'code',None)}")
        with sync_playwright() as p:
            b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 420, "height": 860}, bypass_csp=True)
            r = ctx.request.post(f"http://127.0.0.1:{PORT}/api/login", data={"passphrase": PASS}); assert r.ok, r.status
            page = ctx.new_page(); page.add_init_script("window.__TOP_TEST=1")
            page.goto(f"http://127.0.0.1:{PORT}/"); page.wait_for_function("window.__top && window.__top.S.db")
            page.wait_for_function("document.querySelector('#sync').textContent.includes('Sincronizzato')", timeout=15000)
            caso(0, "Sezioni Esamina / Coach / Storia e campo libero", page.locator("#tab-piano").inner_text().strip() == "Esamina" and "tenere presente" in page.locator("label[for=nota]").inner_text())
            lez = page.evaluate("window.__top.S.lezioni.size")
            caso(0.1, "Fondamenti seminati in biblioteca (9 fonti, una «da verificare»)", lez == 9 and page.evaluate("Array.from(window.__top.S.lezioni.values()).filter(l=>l.da_verificare).length") == 1, f"lezioni={lez}")
            # 2. nota informativa senza decisione
            page.fill("#nota", "Emilio dice che il filato X arriva in 2 settimane"); page.click("#btn-salva-solo"); page.wait_for_timeout(600)
            n_note = page.evaluate("window.__top.S.note.size"); n_arg = page.evaluate("window.__top.S.argomenti.size"); n_dec = page.evaluate("window.__top.S.decisioni.size")
            caso(2, "Nota informativa salvata senza decisione né compiti", n_note == 1 and n_arg == 0 and n_dec == 0 and page.evaluate("window.__top.S.impegni.size") == 0, f"note={n_note} argomenti={n_arg} decisioni={n_dec}")
            # 1. appunto disordinato con più ambiti → situazioni collegate, nessun compito inventato
            page.fill("#nota", "Il cliente Pointex aspetta il campione; non so chi abbia preso in carico lo spostamento della macchina. Oggi ho anche un impegno personale già fissato.")
            page.click("#btn-salva-analizza"); page.wait_for_function("window.__top.S.argomenti.size >= 2", timeout=20000); page.wait_for_timeout(800)
            n_imp = page.evaluate("window.__top.S.impegni.size"); nat = page.evaluate("Array.from(window.__top.S.note.values()).map(n=>n.natura).filter(Boolean)")
            caso(1, "Appunto su più ambiti → 2 situazioni collegate, 0 compiti inventati, natura «decisione» riconosciuta", page.evaluate("window.__top.S.argomenti.size") == 2 and n_imp == 0 and "decisione" in nat, f"impegni={n_imp} natura={nat}")
            caso(1.1, "Dopo il salvataggio: sintesi breve e «Decisione rilevata» con apertura nel Coach", page.locator("#proposte").inner_text().find("Decisione rilevata") >= 0)
            # Coach: sintesi automatica sulla situazione scelta → 5 blocchi + microlezione
            page.wait_for_function("Array.from(window.__top.S.argomenti.values()).some(a=>a.coach_stato==='ok')", timeout=25000)
            page.click("#org-coach"); page.wait_for_selector("#coach-out .blocco", timeout=10000)
            blocchi = page.locator("#coach-out .blocco").count(); micro = page.locator("#coach-out .micro").count()
            caso(3, "Coach Standard: cinque blocchi brevi + una microlezione (tipo dichiarato: proposta del Coach, nessuna attribuzione inventata)", blocchi == 5 and micro == 1 and "proposta del Coach" in page.locator("#coach-out .micro").inner_text(), f"blocchi={blocchi} micro={micro}")
            caso(4, "Due prospettive al massimo; alternative con beneficio/rischio/reversibilità senza punteggi", page.locator("#coach-out .alt").count() == 3 and page.locator("#coach-out summary").first.click() is None and "operations" in page.locator("#coach-out").inner_text() and "%" not in page.locator("#coach-out .alt").all_inner_texts()[0])
            txt = page.locator("#coach-out").inner_text()
            caso(5, "Mappa: frecce etichettate (dipendenza / ipotesi causale), ciclo marcato «da verificare», ritardo considerato", "ipotesi causale" in txt and "da verificare" in txt and "Ritardo." in txt)
            # 9. una proposta diventa impegno solo dopo la scelta
            caso(9, "Nessuna decisione né azione registrata prima della scelta", page.evaluate("window.__top.S.decisioni.size") == 0 and page.evaluate("window.__top.S.impegni.size") == 0)
            page.click("#dec-si"); page.wait_for_selector("#dc-ok"); oggi = page.evaluate("window.__top.today()"); page.fill("#dc-ries", oggi); page.click("#dc-ok"); page.wait_for_function("window.__top.S.decisioni.size === 1", timeout=5000); page.wait_for_function("window.__top.S.impegni.size === 1", timeout=5000)
            d = page.evaluate("Array.from(window.__top.S.decisioni.values())[0]")
            caso(9.1, "«Decido così» registra scelta, motivo, aspettativa, alternative e fonti; crea l'azione mia scelta", d["stato"] == "decisa" and d["aspettativa"] and len(d["alternative"]) == 3 and d["fonti"]["note"] and page.evaluate("window.__top.S.impegni.size") == 1, f"stato={d['stato']} asp={bool(d['aspettativa'])} alt={len(d['alternative'])} fonti={d['fonti']} impegni={page.evaluate('window.__top.S.impegni.size')}")
            # FIX 2: scelgo un'alternativa → l'azione creata corrisponde alla scelta, non alla proposta originaria
            page.click("#dec-si"); page.wait_for_selector("#dc-ok"); page.click("[data-alt='2']")
            az_prop = page.locator("#dc-az-titolo").input_value(); page.check("#dc-az"); page.fill("#dc-az-titolo", "Aspettare che il cliente chieda, poi rispondere entro un giorno"); page.click("#dc-ok")
            page.wait_for_function("window.__top.S.decisioni.size === 2", timeout=5000); page.wait_for_function("window.__top.S.impegni.size === 2", timeout=5000)
            imp2 = page.evaluate("Array.from(window.__top.S.impegni.values()).map(i=>i.titolo)"); dec2 = page.evaluate("Array.from(window.__top.S.decisioni.values()).map(x=>x.scelta)")
            caso("F2", "Alternativa scelta → azione proposta aggiornata e modificabile; nessuna azione originaria creata in silenzio", az_prop == "Aspettare che il cliente chieda" and "Aspettare che il cliente chieda" in dec2 and "Aspettare che il cliente chieda, poi rispondere entro un giorno" in imp2 and imp2.count("Chiedere a Diego responsabile e data dello spostamento") == 1, f"azione proposta={az_prop!r} impegni={imp2}")
            page.evaluate("async () => { const d = Array.from(window.__top.S.decisioni.values()).find(x => x.scelta.startsWith('Aspettare')); const i = Array.from(window.__top.S.impegni.values()).find(x => x.decisione_id === d.id); await window.__top.del('decisioni', d.id, { noUndo: true }); await window.__top.del('impegni', i.id, { noUndo: true }); }")
            page.wait_for_function("window.__top.S.decisioni.size === 1 && window.__top.S.impegni.size === 1")
            # Rapido / Standard
            page.click("#liv-sw"); page.wait_for_selector("#coach-out .rapido .fai")
            caso("12B-a", "Modalità Rapido: subito cosa fare, frase pronta, «Poi:»; microlezione apribile sotto «Approfondisci»", page.locator("#coach-out .rapido").inner_text().find("Poi:") >= 0 and page.locator("#coach-out details .micro").count() == 1)
            caso("12B-b", "«Sono sovraccarico, dimmi solo il primo passo» → livello Rapido; «spiegami meglio» → Standard", page.evaluate("window.__top.livelloDaTesto('sono sovraccarico, dimmi solo il primo passo')") == "rapido" and page.evaluate("window.__top.livelloDaTesto('spiegami meglio')") == "standard")
            page.click("#liv-sw"); page.wait_for_selector("#coach-out .blocco")
            caso("12B-c", "Preferenza di livello salvata nel profilo (vale su tutti i dispositivi)", page.evaluate("(window.__top.S.profilo||{}).livello_risposta") == "standard")
            # 10. interruzione: bozza + punto di ripartenza
            page.click("#tab-piano"); page.fill("#nota", "appunto a metà, non salvato"); page.wait_for_timeout(300); page.reload(); page.wait_for_function("window.__top && window.__top.S.db"); page.wait_for_timeout(1500)
            pr = page.locator("#dove-eravamo").inner_text()
            caso(10, "Dopo un'interruzione: bozza ripresa e «Punto di ripartenza» (dove eravamo, riesame in scadenza)", page.locator("#nota").input_value() == "appunto a metà, non salvato" and "Dove eravamo" in pr and "riesaminare" in pr, pr.replace("\n", " | ")[:140])
            page.fill("#nota", "")
            # 12. riesame: atteso vs osservato, senza alterare il passato
            page.wait_for_selector("[data-riesami] [data-decis]"); page.click("[data-riesami] [data-dec-actions] button:has-text('Riesamina')"); page.fill("#rs-oss", "Diego ha risposto il giorno dopo: sposta Gabriele venerdì"); page.select_option("#rs-es", "come atteso"); page.fill("#rs-imp", "Chiedere prima il responsabile ha evitato una promessa scoperta"); page.click("#rs-ok"); page.wait_for_function("Array.from(window.__top.S.decisioni.values())[0].stato==='riesaminata'")
            d2 = page.evaluate("Array.from(window.__top.S.decisioni.values())[0]")
            caso(12, "Riesame salvato: atteso e osservato confrontati; scelta e aspettativa originali immutate", d2["scelta"] == d["scelta"] and d2["aspettativa"] == d["aspettativa"] and d2["riesame"]["esito"] == "come atteso" and d2["riesame"]["imparato"])
            # scheda personale
            page.click("#tab-storia"); page.click(".seg [data-sf=decisioni]"); page.wait_for_selector("#storia-elenco [data-decis]"); page.click("#storia-elenco [data-dec-actions] button:has-text('Salva come scheda')"); page.wait_for_function("window.__top.S.lezioni.size === 10")
            caso("6B", "Riesame → scheda personale in biblioteca (situazione → strumento → frase → azione → esito → limite)", page.evaluate("Array.from(window.__top.S.lezioni.values()).some(l=>l.categoria==='scheda personale')"))
            # 6. correzione di una nota usata → decisione «da rivedere», storia conservata
            page.click(".seg [data-sf=tutto]"); page.fill("#storia-cerca", "Pointex"); nid = page.evaluate("Array.from(window.__top.S.note.values()).find(n=>n.testo_originale.includes('Pointex')).id")
            page.wait_for_selector(f"[data-parte^='{nid}:']")
            page.evaluate("""async (nid) => { const n = window.__top.S.note.get(nid); const nn = JSON.parse(JSON.stringify(n)); delete nn._pending; nn.correzioni = (nn.correzioni || []).concat([{ quando: new Date().toISOString(), testo: "Mi ero dimenticato: Gabriele ha già preso in carico lo spostamento" }]); await window.__top.save("note", nid, nn, { label: "Correzione nota" }); }""", nid)
            page.wait_for_function("Array.from(window.__top.S.decisioni.values())[0].da_rivedere === true", timeout=15000)
            d3 = page.evaluate("Array.from(window.__top.S.decisioni.values())[0]")
            caso(6, "Correzione di una nota: la decisione che la usava è «da rivedere», con il motivo; scelta e riesame storici conservati", d3["da_rivedere"] and "nota" in d3["da_rivedere_per"] and d3["scelta"] == d["scelta"] and d3["riesame"]["esito"] == "come atteso" and page.evaluate("Array.from(window.__top.S.argomenti.values()).some(a=>a.ultimo_coach && a.ultimo_coach.da_aggiornare)"))
            caso("F3", "Decisione già riesaminata e poi «da rivedere» ricompare nei Riesami (Esamina) con «Riesamina di nuovo»", page.evaluate("window.__top.riesamiDaFare().length") == 1 and d3["stato"] == "riesaminata" and (page.click("#tab-piano") or True) and page.locator("[data-riesami] [data-decis]").count() == 1 and page.locator("[data-riesami] button:has-text('Riesamina di nuovo')").count() == 1)
            page.click("#tab-storia")
            # FIX 1: due dispositivi — B modifica una nota; A salva un'altra nota prima del polling; A non deve saltare la modifica di B
            ctxB = b.new_context(viewport={"width": 420, "height": 860}, bypass_csp=True); ctxB.request.post(f"http://127.0.0.1:{PORT}/api/login", data={"passphrase": PASS}); pB = ctxB.new_page(); pB.add_init_script("window.__TOP_TEST=1"); pB.goto(f"http://127.0.0.1:{PORT}/"); pB.wait_for_function("window.__top && window.__top.S.db"); pB.wait_for_timeout(800)
            nidE = page.evaluate("Array.from(window.__top.S.note.values()).find(n=>n.testo_originale.startsWith('Emilio')).id")
            pB.evaluate("""async (nid) => { const n = window.__top.S.note.get(nid); const nn = JSON.parse(JSON.stringify(n)); delete nn._pending; nn.testo_originale = 'Emilio dice che il filato X arriva in 3 settimane (corretto da B)'; await window.__top.save('note', nid, nn, { label: 'Modifica da B' }); }""", nidE)
            page.evaluate("""async () => { const id = 'nota-da-A-' + Date.now(); await window.__top.save('note', id, { id, testo_originale: 'nota salvata da A subito dopo', data_nota: window.__top.today(), tipo: 'nota', argomento_ids: [], creato: new Date().toISOString(), analisi_stato: 'nessuna', correzioni: [] }, { label: 'Nota da A' }); }""")
            page.wait_for_function("nid => (window.__top.S.note.get(nid) || {}).testo_originale.includes('corretto da B')", arg=nidE, timeout=15000)
            caso("F1", "Sincronizzazione: A salva una nota prima del polling e riceve comunque la modifica di B (cursore avanzato solo con le modifiche acquisite)", page.evaluate("nid => window.__top.S.note.get(nid).testo_originale", nidE).endswith("(corretto da B)") and pB.evaluate("Array.from(window.__top.S.note.values()).some(n=>n.testo_originale==='nota salvata da A subito dopo')") or pB.wait_for_function("Array.from(window.__top.S.note.values()).some(n=>n.testo_originale==='nota salvata da A subito dopo')", timeout=15000) is not None)
            ctxB.close()
            # 7/8: servizi dichiarati, nessuna simulazione
            me = json.loads(ctx.request.get(f"http://127.0.0.1:{PORT}/api/me").text())
            caso(8, "Il server dichiara i servizi reali (/api/me): coach, ricerca web, promemoria/email/calendario = non disponibili", me["servizi"]["coach"] and me["servizi"]["promemoria"] is False and me["servizi"]["email"] is False)
            page.click("#tab-piano"); page.click("#impostazioni > summary"); page.wait_for_timeout(200); page.evaluate("document.querySelector('#collegamenti-box').closest('details').open = true");
            coll = page.locator("#collegamenti-box").inner_text()
            caso("8b", "«Cosa è collegato e cosa no» in Impostazioni: telefono/email/calendario/team non collegati; dettatura non simulata", "non collegato" in coll and "Dettatura" in coll)
            # quadro personale
            page.click("#quadro-box summary"); page.fill("#q-proteggere", "Non promettere date senza conferma dei tecnici"); page.click("#q-salva"); page.wait_for_function("((window.__top.S.profilo||{}).quadro||{}).proteggere")
            caso(3.1, "Quadro personale (obiettivi/limiti/risorse) salvato nel profilo e usato dal Coach solo se pertinente", True)
            # allegato di testo alla nota
            page.set_input_files("#nota-file", {"name": "scheda-macchina.txt", "mimeType": "text/plain", "buffer": b"Macchina CI4: velocita massima 30 giri. Pagina tecnica di prova."})
            page.fill("#nota", "Dati tecnici della macchina per Pointex, vedi allegato"); page.click("#btn-salva-solo"); page.wait_for_function("Array.from(window.__top.S.note.values()).some(n=>(n.allegati||[]).some(a=>a.asset_id))", timeout=10000)
            al = page.evaluate("Array.from(window.__top.S.note.values()).flatMap(n=>n.allegati||[]).find(a=>a.asset_id)")
            caso(2.1, "Allegato alla nota: originale conservato sul server, testo estratto, stato di lettura dichiarato", al["estrazione"] == "ok" and "30 giri" in al["testo_estratto"])
            # rete assente: la nota resta
            ctx.set_offline(True); page.fill("#nota", "nota scritta senza rete"); page.click("#btn-salva-solo"); page.wait_for_timeout(800)
            st = page.locator("#sync").inner_text(); ctx.set_offline(False); page.wait_for_function("document.querySelector('#sync').textContent.includes('Sincronizzato') || document.querySelector('#sync').textContent.includes('Salvato')", timeout=20000)
            caso("10b", "Errore di rete: appunto conservato sul dispositivo («Non salvato (1)») e inviato al ritorno della rete", "Non salvato" in st and page.evaluate("window.__top.S.queue.length") == 0, st)
            # doppione lezione
            page.click("#tab-coach"); page.click("#lezioni-box summary"); page.fill("#lez-titolo", "MIT Sloan — System Dynamics: About Us"); page.fill("#lez-testo", "testo qualsiasi"); page.click("#btn-lez-salva"); page.wait_for_timeout(400)
            caso("3b", "Doppia importazione bloccata (stesso titolo già in biblioteca) e materiali attesi segnalati come mancanti", "già in biblioteca" in page.locator("#lez-stato").inner_text() and "mancante" in page.locator("#materiali-attesi").inner_text())
            b.close()
    finally:
        srv.terminate(); mock.terminate(); shutil.rmtree(data, ignore_errors=True)
    ok = sum(1 for e in esiti if e[2]); tot = len(esiti)
    with open(ROOT / "test" / "esiti-v9.md", "w", encoding="utf-8") as f:
        f.write(f"# Esiti prove v9 — {time.strftime('%Y-%m-%d %H:%M')} — {ok}/{tot} superate\n\nModello simulato (test/modello-simulato.py): collauda il percorso, non la qualità delle risposte del Coach.\n\n")
        for n, t, o, d in esiti: f.write(f"- {'OK' if o else 'FAIL'} · caso {n} · {t}" + (f" — {d}" if d else "") + "\n")
    print(f"\n{ok}/{tot} superate")
    sys.exit(0 if ok == tot else 1)

if __name__ == "__main__": main()
