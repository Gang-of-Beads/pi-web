import { chromium } from '@playwright/test';

const findAll = `(function(sel){var out=[];var walk=function(root){var els=root.querySelectorAll(sel);for(var j=0;j<els.length;j++)out.push(els[j]);var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);return out;})`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:8505', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const refresh = await page.evaluate(`(function(){var f=${findAll}('.app-refresh-button')[0];if(!f)return 'no-refresh';var r=f.getBoundingClientRect();var g=${findAll}('button[aria-label="Open settings"]')[0].getBoundingClientRect();return JSON.stringify({refresh:Math.round(r.width)+'x'+Math.round(r.height),gear:Math.round(g.width)+'x'+Math.round(g.height),sameHeight:Math.round(r.height)===Math.round(g.height)});})()`);
console.log('refresh vs gear:', refresh);

const tiles = await page.evaluate(`(function(){var dots=${findAll}('.action-activity');var menus=${findAll}('.list-body.tiles .action-menu-toggle');if(!dots.length||!menus.length)return 'no-tiles';var d=dots[0].getBoundingClientRect();var m=menus[0].getBoundingClientRect();return JSON.stringify({dotCy:+(d.top+d.height/2).toFixed(1),menuCy:+(m.top+m.height/2).toFixed(1),delta:+((d.top+d.height/2)-(m.top+m.height/2)).toFixed(1)});})()`);
console.log('tile dot vs menu centre:', tiles);

await page.evaluate(`(function(){var b=${findAll}('button').filter(function(x){var t=(x.getAttribute('aria-label')||'')+(x.textContent||'');return t.indexOf('session selection')!==-1||t.indexOf('Switch session')!==-1;})[0];if(b)b.click();return !!b;})()`);
await page.waitForTimeout(1500);
const qs = await page.evaluate(`(function(){var rows=${findAll}('.row-wrap');if(!rows.length)return 'no-rows';var wrap=rows[0];var toggle=wrap.querySelector('.row-menu-toggle');var title=wrap.querySelector('.row-title');var sub=wrap.querySelector('.row-subtitle');var state=wrap.querySelector('.row-state, .row-flag');var out={};if(toggle){var t=toggle.getBoundingClientRect();out.toggle=Math.round(t.width)+'x'+Math.round(t.height);}
if(title&&sub){var a=title.getBoundingClientRect(),b=sub.getBoundingClientRect();out.titleRight=Math.round(a.right);out.subRight=Math.round(b.right);out.rightAligned=Math.abs(a.right-b.right)<=1;}
if(state&&toggle){var s=state.getBoundingClientRect(),t2=toggle.getBoundingClientRect();var overlap=!(s.right<t2.left||s.left>t2.right||s.bottom<t2.top||s.top>t2.bottom);out.stateOverlapsToggle=overlap;var el=wrap.getRootNode().elementFromPoint(s.left+s.width/2,s.top+s.height/2);out.hitAtState=el?el.className||el.tagName:'none';}
return JSON.stringify(out);})()`);
console.log('quick switcher tile:', qs);
await page.screenshot({ path: '/tmp/uiux-after/qs-fixed-phone.png' });
console.log('pageerrors:', errors.length);
await browser.close();
