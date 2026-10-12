// ==UserScript==
// @name RTL + Google Translate Auto (v0.8 مصحح)
// @namespace https://viayoo.com/
// @version 0.8
// @description فرض RTL + ترجمة جوجل تلقائية لكل الصفحات مع دعم SPA
// @author You
// @run-at document-start
// @match *://*/*
// @grant none
// ==/UserScript==

(function () {
    'use strict';

    const TARGET = 'ar';
    const SOURCE = 'auto';
    let translateLoaded = false;
    let lastUrl = location.href;

    function forceRTL() {
        const root = document.documentElement;
        if (root) {
            if (root.dir !== 'rtl') root.setAttribute('dir', 'rtl');
            if (root.lang !== TARGET) root.setAttribute('lang', TARGET);
        }

        const body = document.body;
        if (body && body.dir !== 'rtl') body.setAttribute('dir', 'rtl');
    }

    const css = `
        html, body { direction: rtl !important; }
        body { top: 0 !important; position: static !important; }
        p, div, span, h1, h2, h3, h4, h5, h6, li, td, th {
            unicode-bidi: plaintext !important;
        }
        input, textarea, pre, code, [contenteditable] {
            direction: rtl !important;
            text-align: start !important;
        }
        .goog-te-banner-frame, .skiptranslate, #goog-gt-tt, #goog-gt-vt {
            display: none !important;
        }
        .goog-te-gadget { font-size: 0 !important; }
        .goog-text-highlight { background: none !important; box-shadow: none !important; }
    `;

    const style = document.createElement('style');
    style.id = 'rtl-gt-fix';
    style.textContent = css;
    (document.head || document.documentElement || document.body)?.appendChild(style);

    function setGoogleCookies() {
        const cookieValue = `/${SOURCE}/${TARGET}`;
        const host = (location.hostname || 'localhost').toLowerCase();
        const parts = host.split('.').filter(Boolean);
        const domains = new Set();

        if (host) domains.add(host);
        if (parts.length > 1) domains.add('.' + parts.slice(-2).join('.'));
        if (parts.length > 2) domains.add('.' + parts.slice(-3).join('.'));

        domains.forEach((domain) => {
            try {
                const normalizedDomain = domain === 'localhost' ? '' : domain;
                document.cookie = `googtrans=${cookieValue}; path=/;${normalizedDomain ? ` domain=${normalizedDomain};` : ''} SameSite=Lax`;
            } catch (error) {
                console.warn('Google Translate cookie failed:', error);
            }
        });

        try {
            document.cookie = `googtrans=${cookieValue}; path=/; SameSite=Lax`;
        } catch (error) {
            console.warn('Google Translate cookie fallback failed:', error);
        }
    }

    function triggerTranslate() {
        if (translateLoaded) return;

        if (window.doGTranslate && typeof window.doGTranslate === 'function') {
            try {
                window.doGTranslate(`${SOURCE}|${TARGET}`);
                translateLoaded = true;
                return;
            } catch (error) {
                console.warn('doGTranslate failed:', error);
            }
        }

        const selector = document.querySelector('.goog-te-combo');
        if (selector) {
            try {
                selector.value = TARGET;
                selector.dispatchEvent(new Event('change', { bubbles: true }));
                translateLoaded = true;
            } catch (error) {
                console.warn('Google Translate selector failed:', error);
            }
        }
    }

    window.googleTranslateElementInit = function () {
        const gt = window.google && window.google.translate;
        if (!gt || !gt.TranslateElement) {
            return;
        }

        try {
            const container = document.getElementById('google_translate_element');
            if (!container) return;
            if (!container.querySelector('.goog-te-combo')) {
                new gt.TranslateElement({
                    pageLanguage: SOURCE,
                    includedLanguages: TARGET,
                    autoDisplay: false
                }, 'google_translate_element');
            }
        } catch (error) {
            console.warn('Google Translate widget failed:', error);
            return;
        }

        setTimeout(triggerTranslate, 500);
        let attempts = 0;
        const interval = setInterval(() => {
            triggerTranslate();
            if (translateLoaded || attempts++ > 30) {
                clearInterval(interval);
            }
        }, 200);
    };

    function injectGoogleScript() {
        if (document.getElementById('google_translate_element')) return;

        const container = document.createElement('div');
        container.id = 'google_translate_element';
        container.style.display = 'none';
        (document.documentElement || document.body)?.appendChild(container);

        const root = document.head || document.documentElement || document.body;
        if (!root) return;

        if (!(window.google && window.google.translate && window.google.translate.TranslateElement)) {
            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.async = true;
            script.src = 'https://translate.googleapis.com/translate_a/element.js?cb=googleTranslateElementInit';
            root.appendChild(script);
            return;
        }

        window.googleTranslateElementInit();
    }

    forceRTL();
    setGoogleCookies();

    const rootObserver = new MutationObserver(() => {
        forceRTL();
    });
    rootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['dir', 'lang']
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectGoogleScript, { once: true });
    } else {
        injectGoogleScript();
    }

    function handleNavigationChange() {
        if (location.href === lastUrl) return;

        lastUrl = location.href;
        translateLoaded = false;
        setGoogleCookies();
        forceRTL();
        setTimeout(triggerTranslate, 1500);
    }

    const spaObserver = new MutationObserver(() => {
        handleNavigationChange();
    });

    window.addEventListener('load', () => {
        const targetNode = document.body || document.documentElement;
        if (targetNode) {
            spaObserver.observe(targetNode, { childList: true, subtree: true });
        }
    });

    window.addEventListener('popstate', () => {
        handleNavigationChange();
    });
})();
