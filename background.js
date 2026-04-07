'use strict';

const BLOCKED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'devtools://',
  'view-source:',
];

function isChromeWebStoreUrl(parsedUrl) {
  return parsedUrl.hostname === 'chromewebstore.google.com' ||
    (parsedUrl.hostname === 'chrome.google.com' &&
      parsedUrl.pathname.startsWith('/webstore'));
}

function isInjectableUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;
  if (BLOCKED_URL_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(parsedUrl.protocol)) {
      return false;
    }

    if (isChromeWebStoreUrl(parsedUrl)) {
      return false;
    }

    return true;
  } catch (_) {
    return false;
  }
}

function isInjectableTab(tab) {
  return Boolean(tab && Number.isInteger(tab.id) && isInjectableUrl(tab.url));
}

function registerActionListener(chromeApi) {
  chromeApi.action.onClicked.addListener((tab) => {
    if (!isInjectableTab(tab)) {
      console.warn('このページでは拡張機能は実行できません。');
      return;
    }

    chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    }).catch((err) => {
      console.warn('スクリプトの実行がブロックされました:', err.message);
    });
  });
}

if (typeof chrome !== 'undefined' && chrome.action && chrome.scripting) {
  registerActionListener(chrome);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isInjectableUrl,
    isInjectableTab,
    isChromeWebStoreUrl,
    registerActionListener,
  };
}
