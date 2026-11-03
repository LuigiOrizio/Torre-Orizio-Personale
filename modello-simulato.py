#!/usr/bin/env python3
"""Endpoint Anthropic simulato per le prove (nessuna chiave, nessuna rete): risponde a /v1/messages con JSON deterministici
in base al tipo di prompt. Serve a collaudare il percorso completo dell'app, non la qualità del Coach."""
import json, sys, re
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
LOG = []

def testo_utente(body):
    m = body.get("messages") or []
    if not m: return ""
    c = m[-1].get("content")
    if isinstance(c, str): return c
    return " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")

def risposta(body):
    t = testo_utente(body)
    if "Estrai in JSON" in t and '"natura"' in t:
        # organizzazione della nota: due situazioni, nessun impegno dedotto
        segs = [int(x) for x in re.findall(r"^\[(\d+)\]", t, re.M)]
        if "Emilio dice" in t or "solo informazione" in t:
            return {"sintesi": "Informazione sui tempi del filato.", "natura": "informazione", "decisione": "", "argomenti": [{"id": None, "titolo": "Filato X – tempi di consegna", "ambito": "progetti", "situazione": "Emilio riferisce che il filato arriva in due settimane.", "cosa_cambia": "", "seguito_da": "Emilio", "posso_aspettare": "", "passaggi": segs, "collegamento": "sicuro", "motivo": "nuovo", "alternativa_id": None}], "impegni": [], "impegni_chiusi": [], "eventi": [], "contraddizioni": [], "da_chiarire": [], "istruzioni_sospette": False}
        meta = segs[:1]; resto = segs[1:] or segs
        return {"sintesi": "Il cliente aspetta il campione; manca il responsabile dello spostamento macchina.", "natura": "decisione", "decisione": "Che cosa dire al cliente sul campione senza sapere chi sposta la macchina.", "argomenti": [{"id": None, "titolo": "Pointex – campione", "ambito": "italia", "situazione": "Il cliente aspetta il campione.", "cosa_cambia": "Nessuna data promessa.", "seguito_da": "", "posso_aspettare": "", "passaggi": meta, "collegamento": "sicuro", "motivo": "nuovo", "alternativa_id": None}, {"id": None, "titolo": "Officina – spostamento macchina", "ambito": "progetti", "situazione": "Non è chiaro chi ha preso in carico lo spostamento.", "cosa_cambia": "", "seguito_da": "", "posso_aspettare": "", "passaggi": resto, "collegamento": "sicuro", "motivo": "nuovo", "alternativa_id": None}], "impegni": [], "impegni_chiusi": [], "eventi": [], "contraddizioni": [], "da_chiarire": [], "istruzioni_sospette": False}
    if "i cinque blocchi 1" in t:
        rapido = "RAPIDO" in t
        return {"decisione": "Cosa rispondere al cliente sul campione prima di sapere chi sposta la macchina.", "tipo_input": "decisione",
                "cosa_conta": ["Luigi riferisce: il cliente aspetta il campione (nota di oggi).", "Non risulta chi ha preso in carico lo spostamento della macchina (ipotesi: nessuno ancora).", "Luigi ha un impegno personale già fissato oggi (vincolo dichiarato)."],
                "obiettivi_toccati": [], "mossa": "Chiedere a Diego una conferma di responsabile e data prima di rispondere al cliente.", "motivo": "Una data promessa senza responsabile crea un impegno che non controlli.",
                "prossimo_passo": "Oggi: un messaggio a Diego con una domanda sola; al cliente, se chiede, dire che confermi domani.", "da_verificare": "Se Diego non risponde entro domani la disponibilità del campione resta incerta.",
                "cosa_smentirebbe": "Una conferma già data da Diego che Luigi non ha letto.", "domanda_coach": "", "assunzione": "Lo spostamento non è ancora stato assegnato.",
                "alternative": [{"opzione": "Chiedere conferma a Diego prima di rispondere", "beneficio": "nessuna promessa scoperta", "costo_rischio": "un giorno di attesa", "reversibile": "sì", "quando_preferirla": "quando il cliente può aspettare un giorno"}, {"opzione": "Rispondere subito al cliente con una data stimata", "beneficio": "cliente rassicurato", "costo_rischio": "promessa senza responsabile", "reversibile": "in parte", "quando_preferirla": "solo se la data è già confermata"}, {"opzione": "Aspettare che il cliente chieda", "beneficio": "nessuno sforzo", "costo_rischio": "sollecito e fiducia", "reversibile": "sì", "quando_preferirla": "mai, se il cliente aspetta"}],
                "prospettive": [{"disciplina": "operations", "cosa_cambia": "senza responsabile non esiste una data: la capacità dell'officina decide."}],
                "collegamenti": [{"da": "Cliente Pointex", "a": "Campione", "tipo": "dipendenza operativa", "etichetta": "aspetta", "stato": "documentato", "fonte": "nota di oggi"}, {"da": "Campione", "a": "Spostamento macchina", "tipo": "dipendenza operativa", "etichetta": "richiede", "stato": "documentato", "fonte": "nota di oggi"}, {"da": "Solleciti", "a": "Interruzioni in officina", "tipo": "ipotesi causale", "etichetta": "più solleciti, più interruzioni", "stato": "ipotesi", "fonte": "ipotesi"}],
                "dinamiche": {"ritardo": "tra richiesta a Diego e risposta: almeno un giorno", "accumulo": "", "ciclo": "informazioni mancanti → solleciti → interruzioni → meno aggiornamenti → informazioni mancanti (da verificare)", "intervento": "un passaggio di informazione fisso dall'officina"},
                "microlezione": {"strumento": "Chiarire chi è responsabile e quando, prima di promettere (coordinare attraverso il risultato).", "fonte": "", "tipo": "proposta del Coach", "nel_tuo_caso": "La domanda a Diego precede qualsiasi data al cliente.", "esempio": "Diego, chi segue lo spostamento della macchina e per quando? Mi serve per rispondere a Pointex.", "limite": "Se Diego non decide le priorità, la domanda va a Carlo."},
                "in_breve": "Il cliente aspetta; manca il responsabile dello spostamento. " + ("Risposta rapida." if rapido else "Risposta standard."), "chi_e_quando": "Luigi, oggi (proposto)", "compromesso": "", "segnale": "Risposta di Diego entro domani", "precedente": "", "cosa_cambia": "", "prossima_mossa": "Chiedere a Diego una conferma di responsabile e data prima di rispondere al cliente.", "quando": "oggi", "posso_aspettare": {"si": False, "fino_a": ""}, "rischio": "Se Diego non risponde entro domani la disponibilità del campione resta incerta.", "come_dirlo": "Diego, chi segue lo spostamento della macchina e per quando? Mi serve per rispondere a Pointex.",
                "fatti": ["Luigi riferisce: il cliente aspetta il campione."], "ipotesi": ["Nessuno ha ancora preso in carico lo spostamento."], "contraddizioni": [], "spiegazione_alternativa": "", "ragionamento": "breve", "principio": {"testo": "", "fonte": "", "nesso": ""}, "manca": "Chi sposta la macchina e quando.", "apprendimento": {"crescita_personale": "", "contributo_aziendale": ""}, "aspettativa": "Entro domani Diego indica responsabile e data.", "azione_proposta": {"titolo": "Chiedere a Diego responsabile e data dello spostamento", "tipo": "mia", "data": None}, "impegni_contraddetti": [], "istruzioni_sospette": False}
    if '"titolo":"..."' in t: return {"titolo": "Situazione – oggetto"}
    if '"principi"' in t: return {"principi": [{"testo": "Principio di prova", "riferimento": "pagina 1"}], "istruzioni_sospette": False}
    if "Trascrivi fedelmente" in t: return "TESTO TRASCRITTO DI PROVA"
    if '"natura"' in t and "NUOVA CORREZIONE" in t: return {"natura": "novità", "cosa_cambia": "", "argomenti": [], "impegni_da_verificare": [], "nuovi_impegni": [], "istruzioni_sospette": False}
    return {"ok": True, "istruzioni_sospette": False}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        LOG.append(testo_utente(body)[:200])
        r = risposta(body); text = r if isinstance(r, str) else json.dumps(r, ensure_ascii=False)
        out = json.dumps({"id": "msg_sim", "type": "message", "role": "assistant", "model": body.get("model", "sim"), "content": [{"type": "text", "text": text}], "stop_reason": "end_turn"}).encode("utf-8")
        self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(out))); self.end_headers(); self.wfile.write(out)
    def do_GET(self):
        out = json.dumps({"chiamate": len(LOG), "ultime": LOG[-5:]}).encode(); self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(out))); self.end_headers(); self.wfile.write(out)

if __name__ == "__main__":
    print("modello simulato sulla porta", PORT, flush=True)
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
