// ==UserScript==
// @name           URLBar 2.0
// @version        1.2.0
// @description    Floating spotlight URL bar + bookmarks dynamiques + icon injection + middle-click background
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

    // Icon key → filename mapping (PNGs dans zen-about-favicons/icons/)
    const ICON_MAP = {
        'preferences': 'preferences.png',
        'config':      'config.png',
        'addons':      'addons.png',
        'processes':   'processes.png',
        'newtab':      'newtab.png',
        'debugging':   'debugging.png',
        'support':     'support.png',
    };

    // Extrait la clé d'icône depuis une URL
    // about:config → 'config', #zenabout=config → 'config'
    function getIconKey(url) {
        const hashMatch = url.match(/#zenabout=(.+)$/);
        if (hashMatch) return hashMatch[1];
        const aboutMatch = url.match(/^about:([a-z]+)/);
        if (aboutMatch) return aboutMatch[1];
        return null;
    }

    // ═══════════════════════════════════════════════════

    const URLBar20 = {
        log(msg) { console.log('%c[URLBar-2.0]', 'color:#00d4ff;font-weight:bold', msg); },

        // Flag partagé — true quand l'urlbar flottante est active
        floatingActive: false,

        // Cache des data URLs d'icônes (key → data:image/png;base64,...)
        iconCache: {},

        // Charge les icônes PNG depuis zen-about-favicons/icons/ en mémoire
        async loadIcons() {
            const iconDir = PathUtils.join(
                PathUtils.profileDir, 'chrome', 'sine-mods', 'zen-about-favicons', 'icons'
            );
            for (const [key, filename] of Object.entries(ICON_MAP)) {
                try {
                    const path = PathUtils.join(iconDir, filename);
                    if (!(await IOUtils.exists(path))) continue;
                    const bytes = await IOUtils.read(path);
                    let binary = '';
                    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                    this.iconCache[key] = 'data:image/png;base64,' + btoa(binary);
                } catch (e) { /* icône manquante, skip */ }
            }
            // Processes: icône chrome native (SVG) — pas de PNG dispo
            if (!this.iconCache['processes']) {
                this.iconCache['processes'] = 'chrome://global/skin/icons/performance.svg';
            }

            this.log(`iconCache: ${Object.keys(this.iconCache).length} icônes chargées`);
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

            // Future modules
            // this.sidebotIntegration(); // Feature #3
            // this.topUrlbarStyle();     // Feature #4

            this.log('initialized ✅');
        },

        // ═══════════════════════════════════════════════════
        // Module: Middle-click → Floating URL Bar (Feature #1)
        // ═══════════════════════════════════════════════════
        middleClickFocus() {
            const PREF_URLBAR = 'zen.urlbar.behavior';

            window.addEventListener('mousedown', (e) => {
                if (e.button !== 1) return;
                if (e.target.closest('#navigator-toolbox, #urlbar')) return;

                e.preventDefault();
                e.stopPropagation();
                this.floatingActive = true;
                Services.prefs.setStringPref(PREF_URLBAR, 'floating-on-type');
                setTimeout(() => {
                    document.getElementById('Browser:OpenLocation').doCommand();
                }, 50);
            }, true);

            gURLBar.inputField.addEventListener('blur', () => {
                if (this.floatingActive) {
                    this.floatingActive = false;
                    Services.prefs.setStringPref(PREF_URLBAR, 'normal');
                }
            });

            this.log('middleClickFocus actif (middle-click → floating urlbar ✨)');
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

                    // Injecter les icônes about: depuis iconCache
                    if (wantCompact) {
                        ctx.results.forEach(r => {
                            const key = getIconKey(r.payload?.url || '');
                            if (key && self.iconCache[key]) {
                                r.payload.icon = self.iconCache[key];
                            }
                        });
                    }

                    const result = origOnQueryResults(ctx);

                    // Restaurer l'array original pour le prochain query
                    ctx.results = savedResults;

                    return result;
                }

                return origOnQueryResults(ctx);
            };

            this.log('dynamicBookmarks actif (compact ↔ extended filtering)');
        },
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') URLBar20.init();
    else document.addEventListener('DOMContentLoaded', () => URLBar20.init(), { once: true });
})();
