import { chromium } from '@playwright/test';

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await page.goto('http://127.0.0.1:8505', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

const samples = await page.evaluate(`(function(){
  var out=[];
  var effectiveBackground=function(el){
    var node=el;
    while(node){
      if(node.nodeType===1){
        var bg=getComputedStyle(node).backgroundColor;
        if(bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')return bg;
      }
      node=node.parentElement||(node.getRootNode&&node.getRootNode().host)||null;
    }
    return 'rgb(255,255,255)';
  };
  var walk=function(root){
    var els=root.querySelectorAll('small, .action-menu-toggle, .row-subtitle, .section-count');
    for(var i=0;i<els.length;i++){
      var el=els[i];var r=el.getBoundingClientRect();
      if(r.width<2||r.height<2)continue;
      var cs=getComputedStyle(el);
      out.push({cls:(el.className||el.tagName).toString().slice(0,40),color:cs.color,bg:effectiveBackground(el),size:cs.fontSize,opacity:cs.opacity});
    }
    var kids=root.querySelectorAll('*');
    for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}
  };
  walk(document);
  return JSON.stringify(out.slice(0,40));
})()`);

const rows = JSON.parse(samples);
const seen = new Map();
for (const row of rows) {
  const key = `${row.cls}|${row.color}|${row.bg}`;
  if (seen.has(key)) continue;
  seen.set(key, ratio(parse(row.color), parse(row.bg)));
}
for (const [key, value] of seen) console.log(value.toFixed(2), key);
const worst = Math.min(...seen.values());
console.log('worst muted-ish ratio:', worst.toFixed(2), worst >= 4.5 ? 'PASSES AA' : 'BELOW AA');
await browser.close();
