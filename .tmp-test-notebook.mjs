import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const APP_DIR = 'c:\\Users\\Pichau\\Desktop\\my features\\cs-demo-analyst\\cs-demo-analyst';
const SHOT_DIR = process.env.SCREENSHOT_DIR;
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PROFILE_DIR = path.join(SHOT_DIR, 'isolated-profile');

const electronBin = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');

const errors = [];

async function main() {
  const app = await electron.launch({
    executablePath: electronBin,
    args: [APP_DIR, `--user-data-dir=${PROFILE_DIR}`],
    timeout: 30000,
  });

  const page = await app.firstWindow();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  await page.waitForLoadState('domcontentloaded');
  await new Promise((r) => setTimeout(r, 3000));

  await page.screenshot({ path: path.join(SHOT_DIR, '01-landing.png') });

  // Navigate to "Seu Time" slot
  const clickedSlot = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('Seu Time'));
    if (!link) return 'NOT_FOUND';
    link.click();
    return 'OK';
  });
  console.log('click slot ->', clickedSlot);
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(SHOT_DIR, '02-slot.png') });

  // Click "Notebook" tab
  const clickedTab = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, li, .tabs a')];
    const el = els.find((e) => e.textContent?.trim() === 'Notebook');
    if (!el) return 'NOT_FOUND: ' + els.map(e => e.textContent?.trim()).filter(Boolean).slice(0,30).join(' | ');
    el.click();
    return 'OK';
  });
  console.log('click notebook tab ->', clickedTab);
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(SHOT_DIR, '03-notebook-tab.png') });

  // Focus editor and click into it
  const focused = await page.evaluate(() => {
    const editor = document.querySelector('.notebook-editor .ProseMirror');
    if (!editor) return 'NOT_FOUND';
    editor.focus();
    return 'OK';
  });
  console.log('focus editor ->', focused);

  await page.click('.notebook-editor .ProseMirror').catch(() => {});
  await new Promise((r) => setTimeout(r, 300));

  // Type "/" to open slash menu
  await page.keyboard.type('/');
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(SHOT_DIR, '04-slash-menu.png') });

  const menuState = await page.evaluate(() => {
    const menu = document.querySelector('.slash-menu');
    if (!menu) return 'NOT_FOUND';
    const items = [...menu.querySelectorAll('.slash-menu-item .slash-menu-title')].map((e) => e.textContent);
    return JSON.stringify(items);
  });
  console.log('slash menu items ->', menuState);

  // Arrow down twice, screenshot selection state
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await new Promise((r) => setTimeout(r, 200));
  const selectedAfterArrows = await page.evaluate(() => {
    const sel = document.querySelector('.slash-menu-item.is-selected .slash-menu-title');
    return sel ? sel.textContent : 'NONE';
  });
  console.log('selected after 2x ArrowDown ->', selectedAfterArrows);
  await page.screenshot({ path: path.join(SHOT_DIR, '05-arrow-selection.png') });

  // Press Enter to apply
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(SHOT_DIR, '06-after-enter.png') });

  const editorHtmlAfterEnter = await page.evaluate(() => document.querySelector('.notebook-editor .ProseMirror')?.innerHTML ?? 'NOT_FOUND');
  console.log('editor html after enter ->', editorHtmlAfterEnter);

  // New line, test Escape closes menu
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await new Promise((r) => setTimeout(r, 300));
  const menuVisibleBeforeEscape = !!(await page.evaluate(() => document.querySelector('.slash-menu')));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  const menuVisibleAfterEscape = !!(await page.evaluate(() => document.querySelector('.slash-menu')));
  console.log('menu visible before/after escape ->', menuVisibleBeforeEscape, menuVisibleAfterEscape);
  await page.screenshot({ path: path.join(SHOT_DIR, '07-after-escape.png') });

  // Clean current line, test image markdown paste is neutralized
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await new Promise((r) => setTimeout(r, 200));

  await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '![alt](http://example.com/x.png)');
    const editor = document.querySelector('.notebook-editor .ProseMirror');
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const htmlAfterImagePaste = await page.evaluate(() => document.querySelector('.notebook-editor .ProseMirror')?.innerHTML ?? 'NOT_FOUND');
  console.log('html after pasting image markdown ->', htmlAfterImagePaste);
  await page.screenshot({ path: path.join(SHOT_DIR, '08-after-image-paste.png') });

  // Wait for autosave indicator
  await new Promise((r) => setTimeout(r, 600));
  const saveIndicator = await page.evaluate(() => document.querySelector('.save-indicator')?.textContent?.trim() ?? 'NOT_FOUND');
  console.log('save indicator text ->', saveIndicator);
  await page.screenshot({ path: path.join(SHOT_DIR, '09-save-indicator.png') });

  console.log('CONSOLE_ERRORS ->', JSON.stringify(errors));

  await app.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
