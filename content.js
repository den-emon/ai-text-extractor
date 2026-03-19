'use strict';

(() => {
  if (window.__aiTextExtractorRunning) return;
  window.__aiTextExtractorRunning = true;

  function findMainContent() {
    // Step 1: セマンティック要素を幅広く探索
    const semanticSelectors = [
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

    for (const sel of semanticSelectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length === 0) continue;

      // 複数ある場合はテキスト量が最大のものを選択
      if (elements.length === 1) return elements[0];

      let best = null;
      let bestLen = 0;
      for (const el of elements) {
        const len = el.textContent.trim().length;
        if (len > bestLen) {
          bestLen = len;
          best = el;
        }
      }
      if (best) return best;
    }

    // Step 2: セマンティック要素がない場合、テキスト密度ヒューリスティクスで本文候補を探す
    const candidates = document.querySelectorAll(
      'div, section, td'
    );
    let best = null;
    let bestScore = 0;
    const MIN_TEXT_LENGTH = 200;

    for (const el of candidates) {
      const text = el.textContent.trim();
      if (text.length < MIN_TEXT_LENGTH) continue;

      // テキスト密度 = テキスト長 / 子要素数（リンクだらけのナビ等を排除）
      const linkText = Array.from(el.querySelectorAll('a'))
        .reduce((sum, a) => sum + a.textContent.trim().length, 0);
      const linkRatio = text.length > 0 ? linkText / text.length : 1;
      // リンクテキストが多すぎる要素はナビ等の可能性が高いのでスキップ
      if (linkRatio > 0.5) continue;

      const score = text.length * (1 - linkRatio);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best || document.body;
  }

  function processTextNode(node) {
    const text = node.textContent.replace(/\s+/g, ' ');
    return text.trim() === '' ? null : text;
  }

  const BLOCK_TAGS = new Set([
    'p', 'div', 'section', 'article', 'br', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'dl', 'dt', 'dd', 'details', 'summary',
  ]);

  function getBlockPrefix(tag, node) {
    const match = tag.match(/^h([1-6])$/);
    if (match) return '\n' + '#'.repeat(Number(match[1])) + ' ';
    // #8 ol内のliは番号付きリストにする
    if (tag === 'li') {
      const parent = node.parentElement;
      if (parent && parent.tagName.toLowerCase() === 'ol') {
        const items = Array.from(parent.children).filter(
          (c) => c.tagName.toLowerCase() === 'li'
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
      const cellTexts = Array.from(cells).map(
        (c) => c.textContent.replace(/\s+/g, ' ').trim()
      );
      lines.push('\n| ' + cellTexts.join(' | ') + ' |');
      // ヘッダー行の後にセパレータを挿入
      if (rowIdx === 0 && row.querySelector('th')) {
        lines.push('\n| ' + cellTexts.map(() => '---').join(' | ') + ' |');
      }
    });
    lines.push('\n');
  }

  // #11 フォーム要素・インタラクティブ要素をスキップ
  const SKIP_TAGS = new Set([
    'button', 'input', 'select', 'textarea', 'option',
    'form', 'label', 'fieldset', 'legend',
    'video', 'audio', 'canvas', 'map',
  ]);

  function isNoiseElement(el) {
    const tag = el.tagName.toLowerCase();

    // #11 フォーム・インタラクティブ要素
    if (SKIP_TAGS.has(tag)) return true;

    // #9 非表示要素の除外
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    const style = el.style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;

    const noiseTags = new Set([
      'nav', 'header', 'footer', 'aside', 'script', 'style',
      'noscript', 'iframe', 'svg',
    ]);
    if (noiseTags.has(tag)) return true;

    const role = el.getAttribute('role') || '';
    const noiseRoles = new Set([
      'banner', 'navigation', 'contentinfo', 'complementary', 'search',
    ]);
    if (noiseRoles.has(role)) return true;

    const cl = typeof el.className === 'string' ? el.className : '';
    const id = el.id || '';

    // 特定IDのチェック
    const noiseIds = new Set([
      'ad-banner', 'ad-container', 'sidebar',
      'nav-menu', 'main-menu', 'site-menu',
      'comments', 'disqus_thread',
    ]);
    if (noiseIds.has(id)) return true;

    // クラス名の完全一致チェック
    const noiseClasses = new Set([
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
    const classes = cl.split(/\s+/);
    for (const c of classes) {
      if (noiseClasses.has(c)) return true;
    }

    return false;
  }

  function traverseNode(node, lines) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = processTextNode(node);
      if (text) lines.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();

    // ノイズ要素はスキップ（元DOMを直接探索するため）
    if (isNoiseElement(node)) return;

    // #3 Shadow DOM: shadowRootがあれば内部を探索
    if (node.shadowRoot) {
      node.shadowRoot.childNodes.forEach((child) => traverseNode(child, lines));
      return;
    }

    // #7 img alt テキスト
    if (tag === 'img') {
      const alt = node.getAttribute('alt');
      if (alt && alt.trim()) {
        lines.push('[画像: ' + alt.trim() + ']');
      }
      return;
    }

    // #5 table → Markdownテーブルとして処理
    if (tag === 'table') {
      traverseTable(node, lines);
      return;
    }

    // #5 pre/code → コードブロック
    if (tag === 'pre') {
      const code = node.textContent;
      lines.push('\n```\n' + code + '\n```\n');
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) lines.push('\n');

    const prefix = getBlockPrefix(tag, node);
    if (prefix) lines.push(prefix);

    // #6 リンクURL: <a>をMarkdown形式に変換 + #14 相対URL解決
    if (tag === 'a') {
      const href = node.getAttribute('href');
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        // node.hrefはブラウザが絶対URLに解決済みの値を返す
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
    const lines = [];
    traverseNode(root, lines);
    return lines.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  function formatOutput(title, body) {
    return `【タイトル】\n${title}\n\n【本文】\n${body}`;
  }

  // #15 非ブロッキングのトースト通知
  function showToast(message, isError) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
      'padding:12px 20px', 'border-radius:8px',
      'font-size:14px', 'font-family:sans-serif', 'color:#fff',
      'background:' + (isError ? '#d32f2f' : '#333'),
      'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
      'opacity:0', 'transition:opacity 0.3s',
    ].join(';');
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function copyWithFallback(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => showToast('AI特化モードで抽出・コピーしました！'))
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
        showToast('AI特化モードで抽出・コピーしました！');
      } catch (_) {
        showToast('コピーに失敗しました。', true);
      }
      document.body.removeChild(ta);
    }
  }

  function run() {
    const root = findMainContent();
    const body = extractBodyText(root);

    // #16 抽出結果が空の場合のハンドリング
    if (!body) {
      showToast('本文を抽出できませんでした。このページでは対応していない可能性があります。', true);
      window.__aiTextExtractorRunning = false;
      return;
    }

    const output = formatOutput(document.title, body);
    copyWithFallback(output);
    window.__aiTextExtractorRunning = false;
  }

  // #17 loadイベント待ち中の再クリック対応 + #4 SPA対応
  if (document.readyState === 'complete') {
    run();
  } else {
    window.__aiTextExtractorRunning = false;
    window.addEventListener('load', () => {
      window.__aiTextExtractorRunning = true;
      run();
    }, { once: true });
  }
})();
