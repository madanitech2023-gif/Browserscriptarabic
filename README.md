## مجلد `safe-js`

يحتوي مجلد [`safe-js/`](./safe-js/) على نسخ من ملفات JavaScript التي تمت مراجعتها أمنيًا:

- [`arabicrtl.js`](./safe-js/arabicrtl.js): يفرض اتجاه RTL ويحاول تفعيل الترجمة العربية عبر Google Translate.
- [`arabic-rtl-translate.user.js`](./safe-js/arabic-rtl-translate.user.js): يفرض اتجاه RTL ويترجم النصوص باستخدام خدمات ترجمة خارجية.

وُضعَت الملفات في هذا المجلد لتسهيل تمييز النسخ التي خضعت للمراجعة. هذا لا يعني ضمان خلوها من جميع المخاطر؛ فالملفات التي تتصل بخدمات خارجية تعتمد أيضًا على أمان تلك الخدمات وسياسات الخصوصية الخاصة بها. راجع صلاحيات userscript ومصادره قبل تثبيته أو تشغيله.

// ==UserScript==
// @name ترجمة عربي إجباري + RTL 80% - بدون timeouts
// @namespace https://viayoo.com/
// @version 8.3
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
  const EXCLUDED_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE|OPTION|SVG|BUTTON)$/i;

  function setRTL() {
    const root = document.documentElement;
    root.setAttribute('dir', 'rtl');
    root.setAttribute('lang', 'ar');
    document.body && document.body.setAttribute('dir', 'rtl');
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
    if (!text.trim() || text.trim().length < 4) return true;
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
        onload: function (response) {
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
        onerror: function () {
          reject(new Error('Request failed'));
        },
        ontimeout: function () {
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
        onload: function (response) {
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
        onerror: function () {
          reject(new Error('Request failed'));
        },
        ontimeout: function () {
          reject(new Error('Request timed out'));
        }
      });
    });
  }

  async function googleTranslate(text) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&ie=UTF-8&oe=UTF-8&q=' + encodeURIComponent(text);
    const data = await httpJson(url);
    const translated = Array.isArray(data) && Array.isArray(data[0]) ? data[0].map(item => item && item[0] ? item[0] : '').join('').trim() : '';
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
    const translated = data && Array.isArray(data.translatedText) ? data.translatedText.join('') : (data && data.translatedText ? data.translatedText : '');
    return typeof translated === 'string' && translated.trim() && translated !== text ? translated.trim() : '';
  }

  async function translateText(text) {
    if (!text || !text.trim() || text.trim().length < 4 || ARABIC_PATTERN.test(text)) {
      return text;
    }

    for (const provider of [googleTranslate, myMemoryTranslate, libreTranslate]) {
      try {
        const translated = await provider(text);
        if (translated && translated.trim() !== text.trim()) {
          return translated.trim();
        }
      } catch (error) {
        // Ignore provider errors and continue to the next provider.
      }
    }

    return text;
  }

  async function processNode(node) {
    if (shouldSkipNode(node)) return;

    const original = node.textContent || '';
    const translated = await translateText(original);
    if (translated && translated !== original) {
      node.textContent = translated;
    }
  }

  async function walkTextNodes(root) {
    if (!root || !root.querySelectorAll) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }

    for (const node of nodes) {
      await processNode(node);
    }
  }

  let updateQueued = false;

  function scheduleUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    setTimeout(async () => {
      updateQueued = false;
      if (document.body) {
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
