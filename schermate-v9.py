#!/usr/bin/env python3
"""Schermate di controllo (telefono): Esamina dopo un appunto, Coach Standard, Coach Rapido. Usa server + modello simulato."""
import os, sys, time, subprocess, tempfile, shutil, urllib.request, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent; OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/schermate"); OUT.mkdir(parents=True, exist_ok=True)
PORT, MPORT, PASS = 8094, 8098, "provaprova1"
data = tempfile.mkdtemp(prefix="torre-shot-")
mock = subprocess.Popen([sys.executable, str(ROOT / "test" / "modello-simulato.py"), str(MPORT)], stdout=subprocess.DEVNULL)
env = dict(os.environ, PASSPHRASE=PASS, DATA_DIR=data, PORT=str(PORT), INSECURE_COOKIE="1", ANTHROPIC_API_KEY="x", ANTHROPIC_BASE_URL=f"http://127.0.0.1:{MPORT}")
srv = subprocess.Popen(["node", str(ROOT / "server.js")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
try:
    for _ in range(50):
        try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/me"); break
        except Exception as e:
            if getattr(e, "code", None) == 401: break
            time.sleep(0.2)
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 400, "height": 820}, device_scale_factor=2, bypass_csp=True)
        ctx.request.post(f"http://127.0.0.1:{PORT}/api/login", data={"passphrase": PASS}); page = ctx.new_page(); page.add_init_script("window.__TOP_TEST=1")
        page.goto(f"http://127.0.0.1:{PORT}/"); page.wait_for_function("window.__top && window.__top.S.db"); page.wait_for_timeout(1200)
        page.fill("#nota", "Il cliente Pointex aspetta il campione; non so chi abbia preso in carico lo spostamento della macchina. Oggi ho anche un impegno personale già fissato.")
        page.click("#btn-salva-analizza"); page.wait_for_function("Array.from(window.__top.S.argomenti.values()).some(a=>a.coach_stato==='ok')", timeout=25000); page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / "1-esamina.png"), full_page=True)
        page.click("#org-coach"); page.wait_for_selector("#coach-out .blocco"); page.wait_for_timeout(300)
        page.locator("#coach-out").screenshot(path=str(OUT / "2-coach-standard.png"))
        page.click("#liv-sw"); page.wait_for_selector("#coach-out .rapido"); page.locator("#coach-out").screenshot(path=str(OUT / "3-coach-rapido.png"))
        page.click("#coach-out details > summary"); page.wait_for_timeout(200); page.locator("#coach-out").screenshot(path=str(OUT / "4-approfondisci.png"))
        b.close()
finally:
    srv.terminate(); mock.terminate(); shutil.rmtree(data, ignore_errors=True)
print("schermate in", OUT)
