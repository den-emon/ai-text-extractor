'use strict';

(() => {
  if (window.__aiTextExtractorRunning) return;
  window.__aiTextExtractorRunning = true;

  function findMainContent() {
    return document.querySelector('article') ||
           document.querySelector('main') ||
           document.body;
  }

  function removeNoiseElements(root) {
    const selectors = [
      'nav', 'header', 'footer', 'aside', 'script', 'style',
      'noscript', 'iframe', 'svg',
      '[role="banner"]', '[role="navigation"]', '[role="contentinfo"]',
      '[class*="ad-"]', '[id*="ad-"]', '.advertisement',
      '.social-share', '[class*="share"]', '[class*="social"]',
      '.sidebar', '#sidebar', '[class*="menu"]', '[id*="menu"]',
      '#comments', '.comments', '[class*="comment"]',
      '.related-articles', '.related-posts', '[class*="related"]',
      '.recommended', '[class*="recommend"]',
      '.author-profile', '[class*="author"]',
      '.newsletter', '[class*="subscribe"]'
    ];
    root.querySelectorAll(selectors.join(',')).forEach((el) => el.remove());
  }

  function processTextNode(node) {
    const text = node.textContent.replace(/\s+/g, ' ');
    return text.trim() === '' ? null : text;
  }

  function getBlockPrefix(tag) {
    const match = tag.match(/^h([1-6])$/);
    if (match) return '\n' + '#'.repeat(Number(match[1])) + ' ';
    if (tag === 'li') return '- ';
    return null;
  }

  function traverseNode(node, lines) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = processTextNode(node);
      if (text) lines.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    const isBlock = ['p', 'div', 'section', 'article', 'br', 'li',
                     'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);

    if (isBlock) lines.push('\n');

    const prefix = getBlockPrefix(tag);
    if (prefix) lines.push(prefix);

    node.childNodes.forEach((child) => traverseNode(child, lines));

    if (isBlock) lines.push('\n');
  }

  function extractBodyText(root) {
    const clone = root.cloneNode(true);
    removeNoiseElements(clone);
    const lines = [];
    traverseNode(clone, lines);
    return lines.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  function formatOutput(title, body) {
    return `【タイトル】\n${title}\n\n【本文】\n${body}`;
  }

  function copyWithFallback(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => alert('AI特化モードで抽出・コピーしました！'))
        .catch(() => fallback(text));
    } else {
      fallback(text);
    }

    function fallback(str) {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.top = '-999999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        alert('AI特化モードで抽出・コピーしました！');
      } catch (_) {
        alert('コピーに失敗しました。');
      }
      document.body.removeChild(ta);
    }
  }

  const root = findMainContent();
  const body = extractBodyText(root);
  const output = formatOutput(document.title, body);
  copyWithFallback(output);

  window.__aiTextExtractorRunning = false;
})();
