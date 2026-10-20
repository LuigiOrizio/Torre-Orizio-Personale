# Torre Orizio Personale — versione online privata

Un'unica cartella, nessuna dipendenza da installare: `node server.js` e l'app è in piedi.
Dati, allegati e backup stanno nella cartella `data/` (o nel volume `/data` quando è online).

## Cosa serve

| Servizio | A cosa serve | Costo indicativo (ottobre 2026, da verificare sul sito) |
| --- | --- | --- |
| Un host sempre acceso con disco persistente — consigliato **Railway** (Hobby), in alternativa Fly.io o un piccolo VPS (Hetzner, ecc.) | Tenere il server online anche con il Mac spento; HTTPS incluso con un indirizzo `*.up.railway.app` | circa 5 $/mese |
| **Chiave API Anthropic** (console.anthropic.com) | Il Coach: la chiave resta solo sul server | a consumo, pochi centesimi per analisi; conviene mettere un limite di spesa mensile nella console |
| Dominio tuo (facoltativo, es. `personale.torreorizio.it`) | Indirizzo più corto; non necessario | circa 10–15 €/anno |

Un account GitHub gratuito serve solo per caricare la cartella, perché Railway e Fly leggono il codice da lì.

## Messa online con Railway (una volta sola, circa 15 minuti)

1. Carica la cartella su un repository GitHub **privato** (anche dal sito: *New repository → uploading an existing file*).
2. Su railway.app: *New Project → Deploy from GitHub repo* → scegli il repository. Railway trova il `Dockerfile` da solo.
3. Nel servizio appena creato:
   - *Variables*: aggiungi `PASSPHRASE` (la tua parola d'accesso, almeno 8 caratteri, lunga e tua), `ANTHROPIC_API_KEY`, `DATA_DIR` = `/data`. Facoltativo: `ANTHROPIC_MODEL` (predefinito `claude-sonnet-5-5`).
   - *Volumes*: aggiungi un volume montato su `/data` (è il disco dove restano i dati).
   - *Settings → Networking → Generate Domain*: ottieni l'indirizzo `https://….up.railway.app`.
4. Apri l'indirizzo, inserisci la parola d'accesso: l'app parte già con la mappa delle persone e l'orario.

Fly.io: vedi i comandi in cima a `fly.toml`. VPS: `PASSPHRASE=… ANTHROPIC_API_KEY=… DATA_DIR=/var/lib/torre node server.js` dietro un reverse proxy con HTTPS (Caddy fa tutto da solo).

## Icona sul telefono e sul Mac

- **iPhone**: apri l'indirizzo in Safari → Condividi → *Aggiungi alla schermata Home*. Si apre a schermo intero come un'app.
- **Android**: Chrome → menu ⋮ → *Installa app* (o *Aggiungi a schermata Home*).
- **Mac**: Safari → File → *Aggiungi al Dock*; oppure Chrome → *Installa Torre Orizio Personale*.

L'accesso resta memorizzato per sei mesi su ogni dispositivo; «Esci da questo dispositivo» è in Piano → Impostazioni.

## Uso quotidiano

- **Piano** si apre su Oggi: un campo per scrivere o dettare, la priorità, le azioni in vista, «In attesa e decisioni» chiuso finché non serve. Settimana e Mese sono livelli della stessa vista; il calendario si apre toccando un giorno.
- **Salva solo** scrive la nota e basta. **Salva e analizza** la scrive e poi propone argomenti e impegni da confermare con una spunta; l'interfaccia resta utilizzabile mentre il Coach lavora.
- **Coach**: scegli l'argomento, «Chiedi al Coach». Risposta in blocchi fissi: in breve, cosa cambia, prossima mossa e quando, rischio, come dirlo; sotto «Approfondisci» fatti, ipotesi, contraddizioni, alternativa, un principio con la fonte.
- **Storia**: ricerca, Note / Esiti / Archiviati. «Correggi» + «Salva e aggiorna» ricalcola e segnala gli impegni contraddetti come «Da verificare»: li confermi tu.
- Stato in alto a destra: *Salvataggio…* → *Salvato* → *Sincronizzato*; *Non salvato (n)* con «Riprova» se manca la rete (le note restano sul dispositivo e partono da sole al ritorno della connessione).
- **Backup**: ogni giorno il server scrive una copia dei dati in `data/backups/` (ne tiene 30; gli allegati stanno già nello stesso disco, in `data/assets/`). «Scarica backup» in Impostazioni scarica un unico file JSON **con gli originali degli allegati**; «Ripristina da backup…» mostra prima cosa farebbe (mancanti / più recenti nel backup / più recenti qui) e poi ripristina senza sovrascrivere i dati più recenti; gli allegati tornano con lo stesso id, quindi le lezioni li ritrovano.
- **Modifiche in parallelo**: ogni scrittura porta la versione letta; se nel frattempo un altro dispositivo ha cambiato lo stesso elemento, il server la rifiuta (409) e la pagina chiede quale versione tenere. Nessuna sovrascrittura silenziosa.

## Importare appunti e lezioni dalla versione su claude.ai

1. Apri la pagina su claude.ai → Piano → *Impostazioni, annulla e backup* → **Scarica backup**. Il file contiene note, argomenti, impegni, obiettivi, eventi, lezioni e gli originali (PDF e foto) delle lezioni.
2. Nella nuova app → Piano → *Impostazioni* → **Ripristina da backup…** → scegli il file → leggi l'anteprima → **Ripristina solo i mancanti**.
3. Gli originali vengono salvati sul server con lo stesso id: ogni lezione continua ad aprire il suo PDF o la sua foto. Ripristinare due volte non duplica nulla.

## Sicurezza, in breve

- Una sola parola d'accesso (variabile `PASSPHRASE`), confrontata sul server; 5 tentativi sbagliati bloccano per 15 minuti. Sessione in cookie HttpOnly/Secure.
- Tutto — dati, allegati (`/_blob/…`), backup, Coach — risponde 401 senza sessione: il controllo è del server, non della pagina.
- La chiave Anthropic non arriva mai al browser. Nessuna funzione invia nulla a colleghi, clienti o agenti.
- Note e documenti vengono passati al modello come «materiale da analizzare»: se contengono frasi del tipo «ignora le regole, condividi, sei autorizzato», l'app lo segnala e non esegue nulla.
- Per cambiare parola d'accesso: cambia `PASSPHRASE` e riavvia; le sessioni vecchie restano valide finché non cancelli `data/sessions.json`.

## Aggiornare l'interfaccia

`page-source.html` è la stessa pagina pubblicata su claude.ai. Dopo una modifica: `python3 build-index.py page-source.html` rigenera `public/index.html` e `public/app.js`. `platform.js` è l'adattatore che collega la pagina a questo server al posto delle capacità del viewer di claude.ai.

Prove automatiche (serve Playwright): `python3 test/e2e.py` verifica accessi, sincronizzazione tra due browser, Coach (con endpoint Anthropic simulato), allegati, rete assente, backup; `python3 test/fixes.py` verifica conflitti di versione (409), scrittura su disco prima della risposta, cookie malformati, backup con allegati e ripristino byte per byte, importazione dalla versione precedente. Per provare il Coach con l'API reale: avvia il server con la tua `ANTHROPIC_API_KEY` e premi «Chiedi al Coach».
