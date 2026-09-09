import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/uiux-after';
mkdirSync(OUT, { recursive: true });

const clickBySelector = (selector) => `(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll(${JSON.stringify(selector)});for(var i=0;i<els.length;i++){if(!hit)hit=els[i];}var k=root.querySelectorAll('*');for(var i=0;i<k.length;i++){if(k[i].shadowRoot)walk(k[i].shadowRoot);}};walk(document);if(hit)hit.click();return !!hit;})()`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (event) => errors.push(String(event)));

await page.goto('http://127.0.0.1:8505', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/final-boot.png` });

const openedProject = await page.evaluate(clickBySelector('button.action-main'));
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/final-sessions.png` });

const openedSheet = await page.evaluate(clickBySelector('.compact-scope'));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/final-context-sheet.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

const openedSettings = await page.evaluate(clickBySelector('button[aria-label="Open settings"]'));
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/final-settings.png` });

if (!openedProject || !openedSheet || !openedSettings) throw new Error(`a surface did not open: project=${openedProject} sheet=${openedSheet} settings=${openedSettings}`);
if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
console.log('captured boot, sessions, context sheet and settings at 393x850; pageerrors: 0');
await browser.close();
