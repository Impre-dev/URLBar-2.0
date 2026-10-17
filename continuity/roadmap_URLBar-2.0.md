# Roadmap URLBar-2.0

> Créé le 16/10 (migration régime v2 le même jour — origin/main = `8049589`,
> aucune divergence). Le détail vit dans les commits, le registre porte les
> pointeurs. Référence transverse : `O:/Programmation/Navigateur/.md/Zen-Modes-Affichage.md`.

## File priorisée

- ⭐ **Auto-injection CSS du strip** — le hover du bord droit reste inerte : le
  cache `mods.json` de Sine n'enregistre jamais le `style.chrome` ajouté après
  install (toggle disable/enable testé sans effet, 16/10). Fix : injecter les
  règles en `<style>` JS depuis `edgeHoverTrigger()` (immuni­sé au cache).
- Ouvert : fix BG-Zen `revealIfOrphaned` (hoist de scope — voir registre BG-Zen)

## Leçons de plateforme

1. **FX 158 urlbar — la source top sites a changé** : le provider ne expose
   plus les pins ni les pages about:/zen (source = fréquence + sponsorisé).
   Contournement : s'alimenter de `NewTabUtils.pinnedLinks.links` (lu live par
   query) — les pins de l'opérateur sont la source de vérité, prouvée intacte
   après la maj Zen 1.23.3b. (commit `ceb17bc`)
2. **UrlbarResult FX 158** : constructeur à **objet déstructuré**
   (`{ type, source, payload }`), payload **validé contre
   `UrlbarUtils.RESULT_PAYLOAD_SCHEMA[type]`** (champs du schéma uniquement —
   pas de `displayUrl` URL-type). Les clones spreadés `{...tpl}` perdent le
   prototype → `getDisplayableValueAndHighlights is not a function`. Toujours
   construire via `new tpl.constructor({...})`. Sources : `browser/omni.ja →
   chrome/browser/content/browser/urlbar/`. (commit `ceb17bc`)
3. **Sine — cache mods.json** : `theme.json` n'est relu du disque qu'aux ops
   d'install/update ; un `style.chrome` ajouté après coup n'est **jamais**
   enregistré (toggle inutile). Le JS d'un mod est lui lu du disque à chaque
   start (`loadSubScript ignoreCache`). Contournement : injecter les styles
   depuis le JS. (constat 16/10)

## ✅ Livré & poussé

> Au 16/10 : origin/main = `8049589` — la ligne ci-dessous est **locale, non poussée**.

| Version | Contenu | Commit |
|---|---|---|
| v1.9.0 | Adaptation FX 158/Zen 1.23.3b (compact/extended depuis les pins + COMPACT_INJECT, vraies instances UrlbarResult) + edge hover trigger (strip 6px, dwell 250ms, cooldown) — **hover inerte en attendant l'auto-injection CSS** | `ceb17bc` |
