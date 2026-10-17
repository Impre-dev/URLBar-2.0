# Session du 16/10

## État courant
v1.9.1 commitée (`477096d`) : edge hover trigger **opérationnel** (auto-injection
CSS — cache Sine contourné). Urlbars compact/extended restaurées (pins).
Mandat complet. Reste : push batché, fix BG-Zen (go en attente).

## Journal
- [jalon] Migration régime v2 : repo dans l'install, origin/main = `8049589`, aucune divergence, atelier archivé
- [diag] Casse urlbars = maj FX 158/Zen 1.23.3b : provider top sites changé (plus de pins/about) — prouvé par instrumentation puis expérience force-filtre (lmarena seul affiché sur les 2 urlbars → même vue, patch actif)
- [preuve] Favoris opérateur intacts (25 en base, 25 pins) — aucune écriture du mod
- [jalon] v1.9.0 : compact/extended depuis les pins + UrlbarResult FX158 + edge hover — `ceb17bc`
- [jalon] v1.9.1 : auto-injection CSS du strip, hover validé opérateur — `477096d`
