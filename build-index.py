#!/usr/bin/env python3
"""Genera public/index.html e public/app.js dalla pagina dell'artifact (sorgente unica dell'interfaccia)."""
import re, sys, os
src = sys.argv[1] if len(sys.argv) > 1 else "page-source.html"
here = os.path.dirname(os.path.abspath(__file__))
h = open(os.path.join(here, src), encoding="utf-8").read()
title = re.search(r"<title>(.*?)</title>", h).group(1)
style = re.search(r"<style>(.*?)</style>", h, re.S).group(1)
scripts = re.findall(r"<script>(.*?)</script>", h, re.S)
app_js = scripts[-1]
body = h
body = re.sub(r"<title>.*?</title>\s*", "", body, count=1)
body = re.sub(r'<meta name="claude:viewport-fit-sides"[^>]*>\s*', "", body)
body = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>\s*', "", body)
body = re.sub(r"<style>.*?</style>\s*", "", body, count=1, flags=re.S)
body = re.sub(r"<script>.*?</script>\s*", "", body, flags=re.S)
body = re.sub(r'<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js[^>]*></script>\s*', "", body)
reset = "html{color-scheme:light}:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}img{max-width:100%}[hidden]{display:none!important}"
index = f"""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="Spazio personale privato: Esamina, Coach e Storia.">
<meta name="theme-color" content="#2d6a7c" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171a1e" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Torre Orizio">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="/icons/icon-180.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap">
<style>{reset}</style>
<style>{style}</style>
</head>
<body>
{body.strip()}
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="/platform.js"></script>
<script src="/app.js"></script>
</body>
</html>
"""
os.makedirs(os.path.join(here, "public"), exist_ok=True)
open(os.path.join(here, "public", "index.html"), "w", encoding="utf-8").write(index)
open(os.path.join(here, "public", "app.js"), "w", encoding="utf-8").write(app_js.strip() + "\n")
print("ok", len(index), len(app_js))
