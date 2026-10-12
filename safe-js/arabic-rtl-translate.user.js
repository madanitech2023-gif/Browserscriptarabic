// ==UserScript==
// @name ترجمة عربي إجباري + RTL 80% - بدون timeouts
// @namespace https://viayoo.com/
// @version 8.4
// @description يترجم للعربي بـ 3 API: Google ثم MyMemory ثم Libre - بدون timeouts
// @author You
// @match *://*/*
// @run-at document-idle
// @grant GM_xmlhttpRequest
// @grant GM_addStyle
// @connect translate.googleapis.com
// @connect api.mymemory.translated.net
// @connect libretranslate.com
// ==/UserScript==

(function () {
  'use strict';

  const ARABIC_PATTERN = /[\u0600-\u06FF]/;
  const LATIN_PATTERN = /[A-Za-z]/;
  const EXCLUDED_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE|OPTION|SVG)$/i;
  const loggedProviderErrors = new Set();
  const observedShadowRoots = new WeakSet();
  const TRANSLATION_CONCURRENCY = 4;

  const RTL_STYLES = `
    :host, * {
      direction: rtl !important;
      text-align: start !important;
      unicode-bidi: plaintext !important;
    }

    pre, code, input, textarea, [contenteditable] {
      direction: ltr !important;
      text-align: left !important;
      unicode-bidi: normal !important;
    }
  `;

  function setRTL() {
    const root = document.documentElement;
    root.setAttribute('dir', 'rtl');
    root.setAttribute('lang', 'ar');
    if (document.body) {
      document.body.setAttribute('dir', 'rtl');
    }
  }

  function addStyles() {
    GM_addStyle(`
      html, body {
        direction: rtl !important;
        text-align: start !important;
        unicode-bidi: plaintext !important;
      }

      body {
        max-width: 100% !important;
        width: 100% !important;
        margin: 0 auto !important;
        background: #fff !important;
        box-shadow: none !important;
      }

      pre, code, input, textarea, [contenteditable], .monaco-editor {
        direction: ltr !important;
        text-align: left !important;
        unicode-bidi: normal !important;
      }

      #__next, #root, main {
        width: 100% !important;
        max-width: 100% !important;
      }
    `);
  }

  function shouldSkipNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return true;
    const text = node.textContent || '';
    if (!text.trim()) return true;
    if (!LATIN_PATTERN.test(text)) return true;
    if (ARABIC_PATTERN.test(text)) return true;

    const parent = node.parentElement;
    if (!parent) return true;
    if (EXCLUDED_TAGS.test(parent.tagName)) return true;

    return false;
  }

  function httpJson(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json, text/plain, */*' },
        timeout: 12000,
        ...options,
        onload(response) {
          if (!response.responseText) {
            reject(new Error('Empty response'));
            return;
          }

          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(error);
          }
        },
        onerror() {
          reject(new Error('Request failed'));
        },
        ontimeout() {
          reject(new Error('Request timed out'));
        }
      });
    });
  }

  function httpJsonPost(url, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        data: JSON.stringify(body),
        timeout: 12000,
        onload(response) {
          if (!response.responseText) {
            reject(new Error('Empty response'));
            return;
          }

          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(error);
          }
        },
        onerror() {
          reject(new Error('Request failed'));
        },
        ontimeout() {
          reject(new Error('Request timed out'));
        }
      });
    });
  }

  async function googleTranslate(text) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&ie=UTF-8&oe=UTF-8&q=' + encodeURIComponent(text);
    const data = await httpJson(url);
    const translated = Array.isArray(data) && Array.isArray(data[0])
      ? data[0].map(item => item && item[0] ? item[0] : '').join('').trim()
      : '';
    return translated && translated !== text ? translated : '';
  }

  async function myMemoryTranslate(text) {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=auto|ar';
    const data = await httpJson(url);
    const translated = data && data.responseData && data.responseData.translatedText ? data.responseData.translatedText.trim() : '';
    return translated && translated !== text ? translated : '';
  }

  async function libreTranslate(text) {
    const data = await httpJsonPost('https://libretranslate.com/translate', {
      q: text,
      source: 'auto',
      target: 'ar',
      format: 'text'
    });

    const translated = data && Array.isArray(data.translatedText)
      ? data.translatedText.join('')
      : (data && data.translatedText ? data.translatedText : '');

    return typeof translated === 'string' && translated.trim() && translated !== text ? translated.trim() : '';
  }

  async function translateText(text) {
    if (!text || !text.trim() || !LATIN_PATTERN.test(text) || ARABIC_PATTERN.test(text)) {
      return text;
    }

    for (const provider of [googleTranslate, myMemoryTranslate, libreTranslate]) {
      try {
        const translated = await provider(text);
        if (translated && translated.trim() !== text.trim()) {
          return translated.trim();
        }
      } catch (error) {
        const providerName = provider.name;
        if (!loggedProviderErrors.has(providerName)) {
          loggedProviderErrors.add(providerName);
          console.warn(`Arabic translation: ${providerName} failed.`, error);
        }
      }
    }

    return text;
  }

  async function processNode(node) {
    if (shouldSkipNode(node)) return;

    const original = node.textContent || '';
    const translated = await translateText(original);
    if (node.textContent === original && translated && translated !== original) {
      node.textContent = translated;
    }
  }

  function addShadowRootStyles(root) {
    if (root.querySelector('style[data-arabic-rtl]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-arabic-rtl', '');
    style.textContent = RTL_STYLES;
    root.appendChild(style);
  }

  function findOpenShadowRoots(root, roots = []) {
    if (!root || !root.querySelectorAll) return roots;
    const elements = root.querySelectorAll('*');
    for (const element of elements) {
      if (element.shadowRoot) {
        const shadowRoot = element.shadowRoot;
        roots.push(shadowRoot);
        if (!observedShadowRoots.has(shadowRoot)) {
          observedShadowRoots.add(shadowRoot);
          addShadowRootStyles(shadowRoot);
          observer.observe(shadowRoot, {
            childList: true,
            subtree: true,
            characterData: true
          });
        }
        findOpenShadowRoots(shadowRoot, roots);
      }
    }
    return roots;
  }

  async function walkTextNodes(root) {
    if (!root || !root.querySelectorAll) return;

    const roots = [root, ...findOpenShadowRoots(root)];
    const nodes = [];
    for (const textRoot of roots) {
      const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let current = walker.nextNode();
      while (current) {
        nodes.push(current);
        current = walker.nextNode();
      }
    }

    for (let i = 0; i < nodes.length; i += TRANSLATION_CONCURRENCY) {
      await Promise.all(nodes.slice(i, i + TRANSLATION_CONCURRENCY).map(processNode));
    }
  }

  let updateQueued = false;

  function scheduleUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    setTimeout(async () => {
      updateQueued = false;
      if (document.body) {
        findOpenShadowRoots(document.documentElement);
        await walkTextNodes(document.body);
      }
    }, 150);
  }

  addStyles();
  setRTL();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setRTL();
      scheduleUpdate();
    }, { once: true });
  } else {
    scheduleUpdate();
  }

  const observer = new MutationObserver(() => scheduleUpdate());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
