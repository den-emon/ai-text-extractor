# AI Text Extractor

A Chrome extension that extracts the title and main body text from a web page, formats it for AI use, and copies it to the clipboard.

## Installation

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.

## Usage

Click the extension icon on any supported web page to copy the page title and extracted body text to the clipboard in a labeled, AI-friendly format.

## File Structure

- `manifest.json` - Extension configuration for Manifest V3.
- `background.js` - Service worker that handles extension clicks and injects the content script.
- `content.js` - Body extraction logic, including DOM parsing, noise removal, Markdown formatting, and clipboard copy handling.
- `icon.png` - Extension icon.
- `test/extension.test.js` - Minimal tests using the built-in Node.js test runner.

## Testing

```sh
npm test
```

## Security

- Uses only the `activeTab` permission, so the extension accesses only the tab the user clicked.
- Reads the page DOM only to extract body text, and adds only a notification UI plus a temporary text area for copying.
- Does not make any external network requests.
