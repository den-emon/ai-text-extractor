'use strict';

(() => {
  const TEXT_NODE = typeof Node !== 'undefined' ? Node.TEXT_NODE : 3;
  const ELEMENT_NODE = typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1;
  const RUNNING_FLAG = '__aiTextExtractorRunning';
  const SCHEDULED_FLAG = '__aiTextExtractorScheduled';
  const MIN_TEXT_LENGTH = 200;

  const SEMANTIC_SELECTORS = [
    'main',
    '[role="main"]',
    'article',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.article-body',
    '.post-body',
    '#content',
    '.content',
  ];

  const BLOCK_TAGS = new Set([
    'p', 'div', 'section', 'article', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'dl', 'dt', 'dd', 'details', 'summary',
  ]);

  const SKIP_TAGS = new Set([
    'button', 'input', 'select', 'textarea', 'option',
    'form', 'label', 'fieldset', 'legend',
    'video', 'audio', 'canvas', 'map',
  ]);

  const NOISE_TAGS = new Set([
    'nav', 'header', 'footer', 'aside', 'script', 'style',
    'noscript', 'iframe', 'svg',
  ]);

  const NOISE_ROLES = new Set([
    'banner', 'navigation', 'contentinfo', 'complementary', 'search',
  ]);

  const NOISE_IDS = new Set([
    'ad-banner', 'ad-container', 'sidebar',
    'nav-menu', 'main-menu', 'site-menu',
    'comments', 'disqus_thread',
  ]);

  const NOISE_CLASSES = new Set([
    'ad', 'ads', 'comments',
    'ad-banner', 'ad-container', 'advertisement',
    'social-share', 'share-buttons', 'social-buttons', 'social-links',
    'sidebar', 'nav-menu', 'main-menu', 'site-menu',
    'comments-section', 'comment-list',
    'related-articles', 'related-posts', 'related-links',
    'recommended', 'recommended-articles',
    'author-bio', 'author-profile', 'author-box',
    'newsletter', 'subscribe-form', 'newsletter-signup',
  ]);

  function getDocument(doc) {
    if (doc) return doc;
    return typeof document !== 'undefined' ? document : null;
  }

  function getWindow(win) {
    if (win) return win;
    return typeof window !== 'undefined' ? window : null;
  }

  function getNormalizedText(node) {
    return (node && node.textContent ? node.textContent : '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findMainContent(doc) {
    const targetDocument = getDocument(doc);
    if (!targetDocument) return null;

    const seen = new Set();
    let bestSemantic = null;
    let bestSemanticLength = 0;

    for (const selector of SEMANTIC_SELECTORS) {
      const elements = targetDocument.querySelectorAll(selector);
      for (const el of elements) {
        if (seen.has(el) || isNoiseElement(el)) continue;
        seen.add(el);

        const textLength = getNormalizedText(el).length;
        if (textLength > bestSemanticLength) {
          bestSemantic = el;
          bestSemanticLength = textLength;
        }
      }
    }

    if (bestSemantic && bestSemanticLength > 0) {
      return bestSemantic;
    }

    const candidates = targetDocument.querySelectorAll('div, section, td');
    let best = null;
    let bestScore = 0;

    for (const el of candidates) {
      if (isNoiseElement(el)) continue;

      const text = getNormalizedText(el);
      if (text.length < MIN_TEXT_LENGTH) continue;

      const linkText = Array.from(el.querySelectorAll('a'))
        .reduce((sum, a) => sum + getNormalizedText(a).length, 0);
      const linkRatio = text.length > 0 ? linkText / text.length : 1;
      if (linkRatio > 0.5) continue;

      const score = text.length * (1 - linkRatio);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best || targetDocument.body || targetDocument.documentElement || null;
  }

  function processTextNode(node) {
    const text = (node.textContent || '').replace(/\s+/g, ' ');
    return text.trim() === '' ? null : text;
  }

  function getBlockPrefix(tag, node) {
    const match = tag.match(/^h([1-6])$/);
    if (match) return '\n' + '#'.repeat(Number(match[1])) + ' ';
    if (tag === 'li') {
      const parent = node.parentElement;
      if (parent && parent.tagName.toLowerCase() === 'ol') {
        const items = Array.from(parent.children).filter(
          (child) => child.tagName.toLowerCase() === 'li'
        );
        const idx = items.indexOf(node) + 1;
        return idx + '. ';
      }
      return '- ';
    }
    if (tag === 'blockquote') return '> ';
    if (tag === 'dt') return '\n';
    if (tag === 'dd') return ': ';
    return null;
  }

  function traverseTable(tableNode, lines) {
    const rows = tableNode.querySelectorAll('tr');
    if (rows.length === 0) return;

    rows.forEach((row, rowIdx) => {
      const cells = row.querySelectorAll('th, td');
      const cellTexts = Array.from(cells).map((cell) => getNormalizedText(cell));
      lines.push('\n| ' + cellTexts.join(' | ') + ' |');
      if (rowIdx === 0 && row.querySelector('th')) {
        lines.push('\n| ' + cellTexts.map(() => '---').join(' | ') + ' |');
      }
    });
    lines.push('\n');
  }

  function isHiddenElement(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;

    const style = el.style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
      return true;
    }

    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === 'function') {
      const computedStyle = view.getComputedStyle(el);
      if (
        computedStyle &&
        (computedStyle.display === 'none' || computedStyle.visibility === 'hidden')
      ) {
        return true;
      }
    }

    return false;
  }

  function isNoiseElement(el) {
    if (!el || !el.tagName) return false;

    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag) || NOISE_TAGS.has(tag)) return true;
    if (isHiddenElement(el)) return true;

    const role = el.getAttribute('role') || '';
    if (NOISE_ROLES.has(role)) return true;

    const id = el.id || '';
    if (NOISE_IDS.has(id)) return true;

    const className = typeof el.className === 'string' ? el.className : '';
    const classes = className.split(/\s+/);
    for (const classItem of classes) {
      if (NOISE_CLASSES.has(classItem)) return true;
    }

    return false;
  }

  function traverseNode(node, lines) {
    if (!node) return;

    if (node.nodeType === TEXT_NODE) {
      const text = processTextNode(node);
      if (text) lines.push(text);
      return;
    }

    if (node.nodeType !== ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    if (isNoiseElement(node)) return;

    if (tag === 'br') {
      lines.push('\n');
      return;
    }

    if (node.shadowRoot) {
      node.shadowRoot.childNodes.forEach((child) => traverseNode(child, lines));
      return;
    }

    if (tag === 'img') {
      const alt = node.getAttribute('alt');
      if (alt && alt.trim()) {
        lines.push('[画像: ' + alt.trim() + ']');
      }
      return;
    }

    if (tag === 'table') {
      traverseTable(node, lines);
      return;
    }

    if (tag === 'pre') {
      const code = node.textContent || '';
      lines.push('\n```\n' + code + '\n```\n');
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) lines.push('\n');

    const prefix = getBlockPrefix(tag, node);
    if (prefix) lines.push(prefix);

    if (tag === 'a') {
      const href = node.getAttribute('href');
      const text = getNormalizedText(node);
      const normalizedHref = href ? href.trim().toLowerCase() : '';
      if (
        text &&
        href &&
        !normalizedHref.startsWith('#') &&
        !normalizedHref.startsWith('javascript:')
      ) {
        const absoluteUrl = node.href || href;
        lines.push('[' + text + '](' + absoluteUrl + ')');
      } else if (text) {
        lines.push(text);
      }
      return;
    }

    node.childNodes.forEach((child) => traverseNode(child, lines));

    if (isBlock) lines.push('\n');
  }

  function extractBodyText(root) {
    if (!root) return '';
    const lines = [];
    traverseNode(root, lines);
    return lines.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  function formatOutput(title, body) {
    return `【タイトル】\n${title}\n\n【本文】\n${body}`;
  }

  function showToast(message, isError, doc, win) {
    const targetDocument = getDocument(doc);
    const targetWindow = getWindow(win);
    if (!targetDocument || !targetDocument.body) {
      console.warn(message);
      return;
    }

    const toast = targetDocument.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
      'padding:12px 20px', 'border-radius:8px',
      'font-size:14px', 'font-family:sans-serif', 'color:#fff',
      'background:' + (isError ? '#d32f2f' : '#333'),
      'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
      'opacity:0', 'transition:opacity 0.3s',
    ].join(';');
    targetDocument.body.appendChild(toast);

    const scheduleFrame = targetWindow && typeof targetWindow.requestAnimationFrame === 'function'
      ? targetWindow.requestAnimationFrame.bind(targetWindow)
      : (callback) => setTimeout(callback, 0);
    scheduleFrame(() => { toast.style.opacity = '1'; });

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        if (typeof toast.remove === 'function') {
          toast.remove();
        } else if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 2500);
  }

  function fallbackCopy(text, doc, win) {
    const targetDocument = getDocument(doc);
    if (!targetDocument || !targetDocument.body) {
      showToast('コピーに失敗しました。', true, targetDocument, win);
      return false;
    }

    const textarea = targetDocument.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-999999px';
    targetDocument.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      const copied = targetDocument.execCommand('copy');
      if (!copied) throw new Error('execCommand returned false');
      showToast('AI特化モードで抽出・コピーしました！', false, targetDocument, win);
      return true;
    } catch (_) {
      showToast('コピーに失敗しました。', true, targetDocument, win);
      return false;
    } finally {
      if (textarea.parentNode) {
        textarea.parentNode.removeChild(textarea);
      }
    }
  }

  async function copyWithFallback(text, doc, win) {
    const targetWindow = getWindow(win);
    const targetNavigator = targetWindow && targetWindow.navigator
      ? targetWindow.navigator
      : (typeof navigator !== 'undefined' ? navigator : null);

    if (targetNavigator && targetNavigator.clipboard && targetWindow && targetWindow.isSecureContext) {
      try {
        await targetNavigator.clipboard.writeText(text);
        showToast('AI特化モードで抽出・コピーしました！', false, doc, targetWindow);
        return true;
      } catch (_) {
        return fallbackCopy(text, doc, targetWindow);
      }
    }

    return fallbackCopy(text, doc, targetWindow);
  }

  async function run(doc, win) {
    const targetDocument = getDocument(doc);
    if (!targetDocument) return false;

    try {
      const root = findMainContent(targetDocument);
      const body = extractBodyText(root);

      if (!body) {
        showToast('本文を抽出できませんでした。このページでは対応していない可能性があります。', true, targetDocument, win);
        return false;
      }

      const output = formatOutput(targetDocument.title || '', body);
      return copyWithFallback(output, targetDocument, win);
    } catch (err) {
      console.warn('本文抽出中にエラーが発生しました:', err);
      showToast('本文抽出中にエラーが発生しました。', true, targetDocument, win);
      return false;
    }
  }

  function start(win, doc) {
    const targetWindow = getWindow(win);
    const targetDocument = getDocument(doc);
    if (!targetWindow || !targetDocument) return;
    if (targetWindow[RUNNING_FLAG] || targetWindow[SCHEDULED_FLAG]) return;

    const execute = () => {
      targetWindow[SCHEDULED_FLAG] = false;
      targetWindow[RUNNING_FLAG] = true;
      Promise.resolve(run(targetDocument, targetWindow)).finally(() => {
        targetWindow[RUNNING_FLAG] = false;
      });
    };

    if (targetDocument.readyState === 'loading') {
      targetWindow[SCHEDULED_FLAG] = true;
      targetWindow.addEventListener('DOMContentLoaded', execute, { once: true });
      return;
    }

    execute();
  }

  const api = {
    findMainContent,
    processTextNode,
    getBlockPrefix,
    isNoiseElement,
    traverseNode,
    extractBodyText,
    formatOutput,
    copyWithFallback,
    run,
    start,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  start();
})();
