// ==UserScript==
// @name           URLBar 2.0
// @version        1.5.0
// @description    Floating spotlight URL bar + bookmarks dynamiques + icon injection + middle-click background + compact mode TB fix
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════
    //  Config — Compact set patterns
    //  URLs matching these patterns = compact set
    //  Everything else = extended set
    // ═══════════════════════════════════════════════════

    const COMPACT_PATTERNS = [
        /^about:/,                               // about: pages directes (existantes)
        /^https:\/\/example\.com#zenabout=/,     // hash-redirect about: bookmarks
        /^https:\/\/docs\.zen-browser\.app/,     // Zen docs
        /^https:\/\/zen-browser\.app/,           // Zen website (release-notes, mods)
        /^https:\/\/sineorg\.github\.io/,        // Sine store
    ];

    // Hash → real about: URL mapping
    const ABOUT_MAP = {
        'preferences': 'about:preferences',
        'config':      'about:config',
        'addons':      'about:addons',
        'processes':   'about:processes',
        'newtab':      'about:newtab',
        'debugging':   'about:debugging#/setup',
        'support':     'about:support',
    };

    // ═══════════════════════════════════════════════════

    const URLBar20 = {
        log(msg) { console.log('%c[URLBar-2.0]', 'color:#00d4ff;font-weight:bold', msg); },

        // Flag partagé — true quand l'urlbar flottante est active
        // Getter/setter avec hover lock automatique à la fermeture (anti-flash)
        _floatingActive: false,
        _hoverLockUntil: 0,
        get floatingActive() { return this._floatingActive; },
        set floatingActive(v) {
            if (this._floatingActive && !v) {
                // Anti-flash: hover lock + cacher #urlbar pendant la transition
                this._hoverLockUntil = Date.now() + 400;
                const urlbar = document.getElementById('urlbar');
                if (urlbar) {
                    urlbar.style.setProperty('display', 'none', 'important');
                    setTimeout(() => { urlbar.style.removeProperty('display'); }, 50);
                }
            }
            this._floatingActive = v;
        },

        // Cache des data URLs d'icônes (key → data:image/png;base64,...)
        iconCache: {},

        // Map domaine → clé d'icône (chargé depuis favicon-map.json)
        // ex: { "chat.mistral.ai": "lechat", "chatgpt.com": "chatgpt" }
        domainToIconKey: {},

        // Auto-scan les dossiers d'icônes — aucune liste hardcoded
        // Scan: zen-about-favicons/icons/{light|dark}/ + CustomFavicon/icons/
        // Clé = nom de fichier sans extension, lowercased
        async loadIcons() {
            // Detect theme: icons/light/ (white) for dark theme, icons/dark/ (black) for light theme
            const mm = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
            let isDark = mm && mm.matches;
            if (!isDark) {
                const bg = window.getComputedStyle(document.documentElement).getPropertyValue('background-color');
                const m = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (m) isDark = (0.299 * parseInt(m[1]) + 0.587 * parseInt(m[2]) + 0.114 * parseInt(m[3])) / 255 < 0.5;
            }
            const aboutSubdir = isDark ? 'light' : 'dark';
            const dirs = [
                PathUtils.join(PathUtils.profileDir, 'chrome', 'sine-mods', 'zen-about-favicons', 'icons', aboutSubdir),
                PathUtils.join(PathUtils.profileDir, 'chrome', 'sine-mods', 'CustomFavicon', 'icons'),
            ];
            for (const dir of dirs) {
                try {
                    if (!(await IOUtils.exists(dir))) continue;
                    const files = await IOUtils.getChildren(dir);
                    for (const filePath of files) {
                        if (!filePath.toLowerCase().endsWith('.png')) continue;
                        // Extrait la clé: config.png → 'config', ChatGPT.png → 'chatgpt'
                        const filename = filePath.split(/[/\\]/).pop();
                        const key = filename.replace(/\.png$/i, '').toLowerCase();
                        try {
                            const bytes = await IOUtils.read(filePath);
                            let binary = '';
                            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                            this.iconCache[key] = 'data:image/png;base64,' + btoa(binary);
                        } catch (e) { /* skip */ }
                    }
                } catch (e) { /* dossier manquant, skip */ }
            }
            // Charger favicon-map.json pour le lookup domaine → icône
            try {
                const mapPath = PathUtils.join(
                    PathUtils.profileDir, 'chrome', 'sine-mods', 'CustomFavicon', 'favicon-map.json'
                );
                if (await IOUtils.exists(mapPath)) {
                    const bytes = await IOUtils.read(mapPath);
                    const text = new TextDecoder().decode(bytes);
                    const map = JSON.parse(text);
                    if (map.custom) {
                        for (const [domain, filename] of Object.entries(map.custom)) {
                            this.domainToIconKey[domain] = filename.replace(/\.png$/i, '').toLowerCase();
                        }
                    }
                }
            } catch (e) { /* favicon-map.json manquant, fallback générique */ }

            this.log(`iconCache: ${Object.keys(this.iconCache).length} icônes, ${Object.keys(this.domainToIconKey).length} domaines mappés`);
        },

        // Extrait une clé d'icône depuis une URL — essaie plusieurs stratégies
        // 1. favicon-map.json (lookup exact par hostname) ← le plus fiable
        // 2. #zenabout=config → 'config'
        // 3. about:config → 'config'
        // 4. shortcuts/chatgpt.html → 'chatgpt'
        // 5. hostname.split('.')[0] → fallback générique
        getIconKey(url) {
            if (!url) return null;
            // Hash URL: #zenabout=config
            const hashMatch = url.match(/#zenabout=(.+)$/);
            if (hashMatch) return hashMatch[1].toLowerCase();
            // About: URL: about:config, about:debugging#/setup
            const aboutMatch = url.match(/^about:([a-z]+)/);
            if (aboutMatch) return aboutMatch[1];
            // File URL: shortcuts/chatgpt.html → 'chatgpt'
            const fileMatch = url.match(/\/shortcuts\/(.+?)\.html/);
            if (fileMatch) return fileMatch[1].toLowerCase();
            // Domain-based: lookup favicon-map.json puis fallback générique
            try {
                const u = new URL(url);
                const host = u.hostname.replace(/^www\./, '');
                // Lookup exact dans favicon-map.json
                if (this.domainToIconKey[host]) return this.domainToIconKey[host];
                return host.split('.')[0].toLowerCase();
            } catch (e) {}
            return null;
        },

        init() {
            if (window.__URLBar20Init) return;
            if (!window.gBrowser || !gBrowser.tabContainer) { setTimeout(() => this.init(), 500); return; }
            window.__URLBar20Init = true;

            this.middleClickFocus();       // Feature #1: Floating URL bar
            this.middleClickBackground();  // Middle-click favoris → background tab
            this.aboutRedirect();          // Feature #2a: Hash-redirect about: pages
            this.loadIcons();              // Charge les icônes about: en mémoire
            this.dynamicBookmarks();       // Feature #2b: Dynamic bookmark filtering
            this.compactModeFix();         // Feature #4: Masquer TB quand urlbar flottante

            this.log('initialized ✅');
        },

        // ═══════════════════════════════════════════════════
        // Module: Middle-click → Floating URL Bar (Feature #1)
        // ═══════════════════════════════════════════════════
        middleClickFocus() {
            const PREF_URLBAR = 'zen.urlbar.behavior';

            // Tracker les ouvertures d'onglets pour détecter les clics sur liens.
            // On NE FAIT PAS preventDefault — Firefox gère l'événement naturellement:
            //   - Clic sur un lien → nouvel onglet (TabOpen) → on détecte → on skip l'urlbar
            //   - Clic sur le background → rien ne se passe → on ouvre l'urlbar
            // Firefox fait déjà toute la détection (liens, boutons, form elements, etc.)
            let lastTabOpen = 0;
            gBrowser.tabContainer.addEventListener('TabOpen', () => {
                lastTabOpen = Date.now();
            });

            window.addEventListener('mousedown', (e) => {
                if (e.button !== 1) return;
                if (e.target.closest('#navigator-toolbox, #urlbar')) return;

                // Capturer l'état SYNCHRONEMENT avant que le blur ne fire
                // (le middle-click sur le background blur l'urlbar instantanément)
                const wasActive = this.floatingActive;

                // NE PAS preventDefault — laisser Firefox traiter l'événement
                const self = this;
                setTimeout(() => {
                    // Un onglet s'est ouvert = clic sur lien → ne pas ouvrir l'urlbar
                    if (Date.now() - lastTabOpen < 250) return;

                    // Toggle: si était active → fermer, sinon → ouvrir
                    if (wasActive) {
                        self.floatingActive = false;
                        Services.prefs.setStringPref(PREF_URLBAR, 'normal');
                        return;
                    }

                    // Pas d'onglet = clic sur background → urlbar flottante
                    self.floatingActive = true;
                    Services.prefs.setStringPref(PREF_URLBAR, 'floating-on-type');
                    document.getElementById('Browser:OpenLocation').doCommand();
                }, 200);
            }, true);

            gURLBar.inputField.addEventListener('blur', () => {
                if (this.floatingActive) {
                    this.floatingActive = false;
                    Services.prefs.setStringPref(PREF_URLBAR, 'normal');
                }
            });

            // ── ENTER → floating URL bar ──
            // Le frame script intercepte Enter directement dans le contenu web.
            // Avantage: accès complet au DOM (activeElement, isContentEditable, etc.)
            //   - Input/Textarea/contentEditable focusé → on laisse passer (form submit)
            //   - Sinon → preventDefault + message async → chrome ouvre l'urlbar flottante
            const FRAME_SCRIPT_ENTER = `
                (function() {
                    function isInField() {
                        let el = content.document.activeElement;
                        if (!el) return false;
                        let tag = el.tagName;
                        if (tag === 'INPUT') {
                            let type = (el.type || '').toLowerCase();
                            // Exclude button-like inputs from blocking Enter
                            if (type === 'button' || type === 'submit' || type === 'reset' || type === 'checkbox' || type === 'radio') return false;
                            return true;
                        }
                        return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
                    }
                    addEventListener('keydown', function(e) {
                        if (e.key !== 'Enter') return;
                        if (isInField()) return;
                        e.preventDefault();
                        e.stopPropagation();
                        sendAsyncMessage('UrlBar20:OpenUrlBar', {});
                    }, true);
                })();
            `;
            Services.mm.loadFrameScript('data:text/javascript,' + encodeURIComponent(FRAME_SCRIPT_ENTER), true);

            // Chrome: recevoir les messages du frame script
            Services.mm.addMessageListener('UrlBar20:OpenUrlBar', () => {
                if (gURLBar.focused) return;
                this.floatingActive = true;
                Services.prefs.setStringPref(PREF_URLBAR, 'floating-on-type');
                document.getElementById('Browser:OpenLocation').doCommand();
            });

            this.log('middleClickFocus actif (middle-click + Enter → floating urlbar ✨)');
        },

        // ═══════════════════════════════════════════════════
        // Module: Middle-click favoris → background tab
        // ═══════════════════════════════════════════════════
        middleClickBackground() {
            if (!gURLBar._whereToOpen) {
                setTimeout(() => this.middleClickBackground(), 500);
                return;
            }

            const original = gURLBar._whereToOpen.bind(gURLBar);

            gURLBar._whereToOpen = function (event) {
                if (event && event.button === 1) {
                    return 'tabshifted';
                }
                return original(event);
            };

            this.log('middleClickBackground actif (middle-click → background tab)');
        },

        // ═══════════════════════════════════════════════════
        // Module: Hash-Redirect Engine (Feature #2a)
        //
        // Intercepte les navigations vers https://example.com#zenabout=xxx
        // → browser.stop() → redirect vers about:xxx
        // Pattern inspiré de BetterSplitView (splitDetector)
        // ═══════════════════════════════════════════════════
        aboutRedirect() {
            const _processing = new WeakSet();

            const redirectListener = {
                onLocationChange(browser, webProgress, request, location, flags) {
                    // Ignorer les navigations same-document (hash changes)
                    if (flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) return;

                    const match = location.spec.match(/#zenabout=(.+)$/);
                    if (!match) return;

                    const key = match[1];
                    const target = ABOUT_MAP[key];
                    if (!target) return;

                    // Anti-reentrance
                    if (_processing.has(browser)) return;
                    _processing.add(browser);

                    // Stopper le chargement immédiatement = zéro flash
                    try { browser.stop(); } catch (e) {}

                    // Redirect vers la vraie page about:
                    try {
                        browser.loadURI(Services.io.newURI(target), {
                            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                        });
                        URLBar20.log(`aboutRedirect: ${key} → ${target}`);
                    } catch (e) {
                        console.warn('[URLBar-2.0] aboutRedirect failed:', e);
                    } finally {
                        setTimeout(() => _processing.delete(browser), 500);
                    }
                },
                QueryInterface: ChromeUtils.generateQI(['nsIWebProgressListener', 'nsISupportsWeakReference']),
            };

            gBrowser.addTabsProgressListener(redirectListener);

            this.log('aboutRedirect actif (7 hash-redirects about: prêts)');
        },

        // ═══════════════════════════════════════════════════
        // Module: Dynamic Bookmarks Filter (Feature #2b)
        //
        // Patch gURLBar.view.onQueryResults pour filtrer
        // les favoris selon le mode (compact vs extended).
        //
        // - floatingActive = false → compact set (about: + zen URLs)
        // - floatingActive = true  → extended set (favoris perso)
        // - Recherche active (typing) → pas de filtre
        //
        // Critique: sauvegarder/restaurer ctx.results pour
        // éviter la destruction du cache de l'urlbar.
        // ═══════════════════════════════════════════════════
        dynamicBookmarks() {
            if (!gURLBar.view?.onQueryResults) {
                setTimeout(() => this.dynamicBookmarks(), 500);
                return;
            }

            const self = this;
            const origOnQueryResults = gURLBar.view.onQueryResults.bind(gURLBar.view);

            gURLBar.view.onQueryResults = function (ctx) {
                // Ne filtrer QUE les top sites (recherche vide)
                if (ctx.results && ctx.results.length && ctx.trimmedSearchString === '') {
                    const savedResults = ctx.results;
                    const wantCompact = !self.floatingActive;

                    ctx.results = savedResults.filter(r => {
                        const url = r.payload?.url || '';
                        const matchesCompact = COMPACT_PATTERNS.some(p => p.test(url));
                        return wantCompact ? matchesCompact : !matchesCompact;
                    });

                    // Safety: si le filtre renvoie 0 résultats, garder l'original
                    if (ctx.results.length === 0) {
                        ctx.results = savedResults;
                    }

                    // Injecter les icônes depuis iconCache (tous modes)
                    ctx.results.forEach(r => {
                        const key = self.getIconKey(r.payload?.url || '');
                        if (key && self.iconCache[key]) {
                            r.payload.icon = self.iconCache[key];
                        }
                    });

                    const result = origOnQueryResults(ctx);

                    // Restaurer l'array original pour le prochain query
                    ctx.results = savedResults;

                    return result;
                }

                return origOnQueryResults(ctx);
            };

            this.log('dynamicBookmarks actif (compact ↔ extended filtering)');
        },

        // ═══════════════════════════════════════════════════
        // Module: Compact Mode Fix (Feature #4)
        //
        // Quand l'urlbar flottante est ouverte, Zen set automatiquement
        // zen-compact-mode-active sur #zen-appcontent-navbar-wrapper →
        // le wrapper passe à 68px → la titlebar/bookmarks apparaissent.
        //
        // Solution: monkey-patcher _setElementExpandAttribute pour bloquer
        // l'attribut zen-compact-mode-active quand floatingActive = true.
        // L'urlbar (position:fixed, z-index:1000) reste visible.
        // Le wrapper reste à 8px → pas de push, pas de TB.
        //
        // Anti-flash: au moment de la fermeture, _hoverLockUntil bloque
        // brièvement zen-has-hover pour éviter que le wrapper ne se rouvre
        // pendant la transition.
        // ═══════════════════════════════════════════════════
        compactModeFix() {
            if (!window.gZenCompactModeManager?._setElementExpandAttribute) {
                setTimeout(() => this.compactModeFix(), 500);
                return;
            }
            if (window.__URLBar20CompactPatch) return;
            window.__URLBar20CompactPatch = true;

            const self = this;
            const orig = gZenCompactModeManager._setElementExpandAttribute.bind(gZenCompactModeManager);

            gZenCompactModeManager._setElementExpandAttribute = function (element, value, attr = 'zen-has-hover') {
                const isWrapper = element?.id === 'zen-appcontent-navbar-wrapper';

                // Bloquer zen-compact-mode-active quand l'urlbar flottante est active
                if (isWrapper && attr === 'zen-compact-mode-active' && self.floatingActive) {
                    return; // Skip — le wrapper reste à 8px
                }

                // Anti-flash: bloquer zen-has-hover brièvement après fermeture
                if (isWrapper && attr === 'zen-has-hover' && value && Date.now() < self._hoverLockUntil) {
                    return; // Skip — évite le flash du vrai urlbar
                }

                return orig(element, value, attr);
            };

            this.log('compactModeFix actif (TB masquée pendant urlbar flottante ✨)');
        },
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') URLBar20.init();
    else document.addEventListener('DOMContentLoaded', () => URLBar20.init(), { once: true });
})();
