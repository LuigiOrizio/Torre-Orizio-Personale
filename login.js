document.getElementById("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const e = document.getElementById("e"); const b = document.getElementById("b"); e.hidden = true; b.disabled = true;
  try {
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ passphrase: document.getElementById("p").value }) });
    if (r.ok) { location.href = "/"; return; }
    const d = await r.json().catch(() => ({}));
    e.textContent = r.status === 429 ? "Troppi tentativi: riprova tra " + Math.ceil((d.retry_in_s || 900) / 60) + " minuti." : "Parola d'accesso non corretta.";
  } catch (err) { e.textContent = "Nessuna connessione al server. Riprova."; }
  e.hidden = false; b.disabled = false;
});
