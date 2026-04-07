'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const background = require('../background.js');
const extractor = require('../content.js');

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

class TestText {
  constructor(text) {
    this.nodeType = TEXT_NODE;
    this.textContent = text;
    this.parentElement = null;
    this.parentNode = null;
  }
}

class TestElement {
  constructor(tagName, attrs = {}, children = []) {
    this.nodeType = ELEMENT_NODE;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.ownerDocument = null;
    this.style = attrs.style ? { ...attrs.style } : {};
    this.hidden = Boolean(attrs.hidden);
    this.id = attrs.id || '';
    this.className = attrs.className || attrs.class || '';
    this.shadowRoot = attrs.shadowRoot || null;

    for (const [key, value] of Object.entries(attrs)) {
      if (['class', 'className', 'hidden', 'id', 'shadowRoot', 'style'].includes(key)) {
        continue;
      }
      this.attributes.set(key, String(value));
    }

    children.forEach((child) => this.appendChild(toNode(child)));
  }

  appendChild(child) {
    child.parentNode = this;
    if (child.nodeType === ELEMENT_NODE) child.parentElement = this;
    this.childNodes.push(child);
    if (child.nodeType === ELEMENT_NODE) this.children.push(child);
    if (this.ownerDocument) assignOwnerDocument(child, this.ownerDocument);
    return child;
  }

  removeChild(child) {
    this.childNodes = this.childNodes.filter((item) => item !== child);
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
    child.parentElement = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  focus() {}

  select() {}

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.childNodes = [new TestText(value)];
    this.children = [];
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
    const results = [];

    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== ELEMENT_NODE) continue;
        if (selectors.some((item) => matchesSelector(child, item))) {
          results.push(child);
        }
        visit(child);
      }
    };

    visit(this);
    return results;
  }

  get href() {
    const href = this.getAttribute('href');
    if (!href) return '';
    try {
      return new URL(href, this.ownerDocument.baseUrl).href;
    } catch (_) {
      return href;
    }
  }
}

class TestDocument {
  constructor(children, options = {}) {
    this.title = options.title || '';
    this.readyState = options.readyState || 'complete';
    this.baseUrl = options.baseUrl || 'https://example.com/articles/1';
    this.defaultView = {
      getComputedStyle: (element) => element.computedStyle || {},
    };
    this.documentElement = el('html', {}, el('body', {}, ...children));
    this.body = this.documentElement.querySelector('body');
    assignOwnerDocument(this.documentElement, this);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  createElement(tagName) {
    const node = el(tagName);
    assignOwnerDocument(node, this);
    return node;
  }

  execCommand(command) {
    return command === 'copy';
  }
}

function assignOwnerDocument(node, doc) {
  if (node.nodeType !== ELEMENT_NODE) return;
  node.ownerDocument = doc;
  for (const child of node.childNodes) {
    assignOwnerDocument(child, doc);
  }
}

function matchesSelector(node, selector) {
  if (selector === '[role="main"]') {
    return node.getAttribute('role') === 'main';
  }
  if (selector.startsWith('.')) {
    return node.className.split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith('#')) {
    return node.id === selector.slice(1);
  }
  return node.tagName.toLowerCase() === selector.toLowerCase();
}

function toNode(value) {
  return typeof value === 'string' ? new TestText(value) : value;
}

function el(tagName, attrs = {}, ...children) {
  return new TestElement(tagName, attrs, children);
}

test('background URL guard allows ordinary pages and blocks restricted pages', () => {
  assert.equal(background.isInjectableUrl('https://example.com/article'), true);
  assert.equal(background.isInjectableUrl('file:///tmp/article.html'), true);
  assert.equal(background.isInjectableUrl('chrome://extensions'), false);
  assert.equal(background.isInjectableUrl('view-source:https://example.com'), false);
  assert.equal(background.isInjectableUrl('https://chromewebstore.google.com/detail/example'), false);
  assert.equal(background.isInjectableUrl('https://chrome.google.com/webstore/detail/example'), false);
  assert.equal(background.isInjectableTab({ id: 1, url: 'https://example.com/article' }), true);
  assert.equal(background.isInjectableTab({ url: 'https://example.com/article' }), false);
});

test('findMainContent selects the best non-empty semantic content', () => {
  const article = el(
    'article',
    {},
    el('h1', {}, 'Useful title'),
    el('p', {}, 'Useful body text for extraction.')
  );
  const doc = new TestDocument([
    el('main', {}, ' '),
    article,
  ]);

  assert.equal(extractor.findMainContent(doc), article);
});

test('extractBodyText formats content and skips common noise', () => {
  const doc = new TestDocument([
    el(
      'article',
      {},
      el('h1', {}, 'Hello'),
      el('nav', {}, 'Navigation must be skipped'),
      el('p', {}, 'Read ', el('a', { href: '/more' }, 'more'), ' now.'),
      el('ol', {}, el('li', {}, 'First'), el('li', {}, 'Second')),
      el('div', { style: { display: 'none' } }, 'Hidden text')
    ),
  ]);

  const body = extractor.extractBodyText(doc.querySelector('article'));

  assert.match(body, /^# Hello/);
  assert.match(body, /Read \[more\]\(https:\/\/example\.com\/more\) now\./);
  assert.match(body, /1\. First/);
  assert.match(body, /2\. Second/);
  assert.doesNotMatch(body, /Navigation must be skipped/);
  assert.doesNotMatch(body, /Hidden text/);
});

test('formatOutput wraps title and body for AI input', () => {
  assert.equal(
    extractor.formatOutput('Page title', 'Body text'),
    '【タイトル】\nPage title\n\n【本文】\nBody text'
  );
});

test('start schedules only one run while the document is still loading', () => {
  const listeners = [];
  const doc = new TestDocument([el('article', {}, 'Body text')], { readyState: 'loading' });
  const win = {
    addEventListener: (eventName, callback, options) => {
      listeners.push({ eventName, callback, options });
    },
  };

  extractor.start(win, doc);
  extractor.start(win, doc);

  assert.equal(win.__aiTextExtractorScheduled, true);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].eventName, 'DOMContentLoaded');
  assert.equal(listeners[0].options.once, true);
});
