# Esiti prove v9 — 2026-11-03 15:41 — 27/27 superate

Modello simulato (test/modello-simulato.py): collauda il percorso, non la qualità delle risposte del Coach.

- OK · caso 11 · Dati non accessibili senza sessione (server: 401) — codice 401
- OK · caso 0 · Sezioni Esamina / Coach / Storia e campo libero
- OK · caso 0.1 · Fondamenti seminati in biblioteca (9 fonti, una «da verificare») — lezioni=9
- OK · caso 2 · Nota informativa salvata senza decisione né compiti — note=1 argomenti=0 decisioni=0
- OK · caso 1 · Appunto su più ambiti → 2 situazioni collegate, 0 compiti inventati, natura «decisione» riconosciuta — impegni=0 natura=['decisione']
- OK · caso 1.1 · Dopo il salvataggio: sintesi breve e «Decisione rilevata» con apertura nel Coach
- OK · caso 3 · Coach Standard: cinque blocchi brevi + una microlezione (tipo dichiarato: proposta del Coach, nessuna attribuzione inventata) — blocchi=5 micro=1
- OK · caso 4 · Due prospettive al massimo; alternative con beneficio/rischio/reversibilità senza punteggi
- OK · caso 5 · Mappa: frecce etichettate (dipendenza / ipotesi causale), ciclo marcato «da verificare», ritardo considerato
- OK · caso 9 · Nessuna decisione né azione registrata prima della scelta
- OK · caso 9.1 · «Decido così» registra scelta, motivo, aspettativa, alternative e fonti; crea l'azione mia scelta — stato=decisa asp=True alt=3 fonti={'note': ['905f63f1-ab5d-4747-a89a-573dd6b89de3'], 'lezioni': ['fond-mit-sd', 'fond-mit-delay', 'fond-deming-pdsa', 'fond-stanford-exp', 'fond-oxford-ci', 'fond-w3c-steps', 'fond-w3c-instructions', 'fond-nng-pd', 'fond-pon-batna'], 'coach_quando': '2026-11-03T15:41:29.822Z'} impegni=1
- OK · caso F2 · Alternativa scelta → azione proposta aggiornata e modificabile; nessuna azione originaria creata in silenzio — azione proposta='Aspettare che il cliente chieda' impegni=['Chiedere a Diego responsabile e data dello spostamento', 'Aspettare che il cliente chieda, poi rispondere entro un giorno']
- OK · caso 12B-a · Modalità Rapido: subito cosa fare, frase pronta, «Poi:»; microlezione apribile sotto «Approfondisci»
- OK · caso 12B-b · «Sono sovraccarico, dimmi solo il primo passo» → livello Rapido; «spiegami meglio» → Standard
- OK · caso 12B-c · Preferenza di livello salvata nel profilo (vale su tutti i dispositivi)
- OK · caso 10 · Dopo un'interruzione: bozza ripresa e «Punto di ripartenza» (dove eravamo, riesame in scadenza) — PUNTO DI RIPARTENZA | Riprendi | Dove eravamo: «Officina – spostamento macchina» — proposta: Chiedere a Diego una conferma di responsabile e
- OK · caso 12 · Riesame salvato: atteso e osservato confrontati; scelta e aspettativa originali immutate
- OK · caso 6B · Riesame → scheda personale in biblioteca (situazione → strumento → frase → azione → esito → limite)
- OK · caso 6 · Correzione di una nota: la decisione che la usava è «da rivedere», con il motivo; scelta e riesame storici conservati
- OK · caso F3 · Decisione già riesaminata e poi «da rivedere» ricompare nei Riesami (Esamina) con «Riesamina di nuovo»
- OK · caso F1 · Sincronizzazione: A salva una nota prima del polling e riceve comunque la modifica di B (cursore avanzato solo con le modifiche acquisite)
- OK · caso 8 · Il server dichiara i servizi reali (/api/me): coach, ricerca web, promemoria/email/calendario = non disponibili
- OK · caso 8b · «Cosa è collegato e cosa no» in Impostazioni: telefono/email/calendario/team non collegati; dettatura non simulata
- OK · caso 3.1 · Quadro personale (obiettivi/limiti/risorse) salvato nel profilo e usato dal Coach solo se pertinente
- OK · caso 2.1 · Allegato alla nota: originale conservato sul server, testo estratto, stato di lettura dichiarato
- OK · caso 10b · Errore di rete: appunto conservato sul dispositivo («Non salvato (1)») e inviato al ritorno della rete — Non salvato (1)
Riprova
- OK · caso 3b · Doppia importazione bloccata (stesso titolo già in biblioteca) e materiali attesi segnalati come mancanti
