'use strict';

chrome.action.onClicked.addListener((tab) => {
  if (!tab.url ||
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('about:') ||
      tab.url.startsWith('https://chrome.google.com/webstore')) {
    console.warn('このページでは拡張機能は実行できません。');
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  }).catch((err) => {
    console.warn('スクリプトの実行がブロックされました:', err.message);
  });
});
