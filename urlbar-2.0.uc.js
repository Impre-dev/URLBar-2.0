// ==UserScript==
// @name           URLBar 2.0
// @version        1.0.0
// @description    Floating spotlight URL bar + bookmarks dynamiques + middle-click background
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
    'use strict';

    const URLBar20 = {
        log(msg) { console.log('%c[URLBar-2.0]', 'color:#00d4ff;font-weight:bold', msg); },

        init() {
            if (window.__URLBar20Init) return;
            if (!window.gBrowser || !gBrowser.tabContainer) { setTimeout(() => this.init(), 500); return; }
            window.__URLBar20Init = true;

            this.middleClickFocus();       // Feature #1: Floating URL bar
            this.middleClickBackground();  // Middle-click favoris → background tab

            // Future modules (à implémenter)
            // this.dynamicBookmarks();   // Feature #2
            // this.sidebotIntegration(); // Feature #3
            // this.topUrlbarStyle();     // Feature #4

            this.log('initialized ✅');
        },

        // ═══════════════════════════════════════════════════
        // Module: Middle-click → Floating URL Bar (Feature #1)
        //
        // Middle-click sur le CONTENU de la page → swap vers
        // zen.urlbar.behavior:floating-on-type → l'urlbar
        // apparaît au centre (genre Spotlight).
        // Au blur → swap back vers normal.
        //
        // Whitelist: on ne déclenche QUE si le click est hors
        // de #navigator-toolbox ET de #urlbar (qui peut être
        // détaché en mode floating).
        // ═══════════════════════════════════════════════════
        middleClickFocus() {
            const PREF_URLBAR = 'zen.urlbar.behavior';
            let floatingActive = false;

            // Middle-click → floating + focus (UNIQUEMENT sur le contenu de page)
            window.addEventListener('mousedown', (e) => {
                if (e.button !== 1) return;

                // ❌ Click dans l'UI (toolbox, sidebar) ou l'urlbar (input + résultats) → comportement natif
                // #urlbar est ajouté car en mode floating, Zen détache l'urlbar du navigator-toolbox
                if (e.target.closest('#navigator-toolbox, #urlbar')) return;

                // ✅ Click sur le contenu de la page → floating URL bar
                e.preventDefault();
                e.stopPropagation();
                floatingActive = true;
                Services.prefs.setStringPref(PREF_URLBAR, 'floating-on-type');
                // Petit délai pour laisser Zen re-render l'urlbar en mode floating
                setTimeout(() => {
                    document.getElementById('Browser:OpenLocation').doCommand();
                }, 50);
            }, true);

            // Blur → swap back normal (uniquement si on a activé le floating)
            gURLBar.inputField.addEventListener('blur', () => {
                if (floatingActive) {
                    floatingActive = false;
                    Services.prefs.setStringPref(PREF_URLBAR, 'normal');
                }
            });

            this.log('middleClickFocus actif (middle-click → floating urlbar ✨)');
        },

        // ═══════════════════════════════════════════════════
        // Module: Middle-click favoris URL bar → background tab
        //
        // Zen force where="tab" (foreground) quand l'urlbar a
        // l'attribut zen-newtab. Ce wrapper intercepte
        // _whereToOpen et convertit "tab" → "tabshifted"
        // (background) pour les middle-clicks.
        // ═══════════════════════════════════════════════════
        middleClickBackground() {
            if (!gURLBar._whereToOpen) {
                setTimeout(() => this.middleClickBackground(), 500);
                return;
            }

            const original = gURLBar._whereToOpen.bind(gURLBar);

            gURLBar._whereToOpen = function (event) {
                // Middle-click (button 1) = TOUJOURS background tab (tabshifted)
                // peu importe la pref zen.urlbar.replace-newtab ou ce que Zen voulait faire
                if (event && event.button === 1) {
                    return 'tabshifted';
                }
                return original(event);
            };

            this.log('middleClickBackground actif (middle-click → background tab)');
        },
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') URLBar20.init();
    else document.addEventListener('DOMContentLoaded', () => URLBar20.init(), { once: true });
})();
