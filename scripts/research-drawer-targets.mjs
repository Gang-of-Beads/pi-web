import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const TARGETS = ["Show session sections", "Hide session sections", "Goals"];

const deepAll = (selector) => `(function(){
  var out=[];
  var walk=function(root){var found=root.querySelectorAll(${JSON.stringify(selector)});for(var j=0;j<found.length;j++)out.push(found[j]);var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return out;
})()`;
const probe = `(function(){
  var rows=[];
  var walk=function(root){var els=root.querySelectorAll("button");
    for(var j=0;j<els.length;j++){var el=els[j];var label=el.getAttribute("aria-label")||el.textContent||"";var r=el.getBoundingClientRect();
      for(var t=0;t<${JSON.stringify(TARGETS)}.length;t++){
        if(label.indexOf(${JSON.stringify(TARGETS[0])})===0||label.indexOf(${JSON.stringify(TARGETS[1])})===0||label.indexOf(${JSON.stringify(TARGETS[2])})===0){
          rows.push({label:label.trim().slice(0,30),cls:el.className,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)});
        }
      }}
    var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return rows;
})()`;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await page.goto("http://127.0.0.1:8505", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="PROJECT-LIST")found=kids[i];}};visit(document);if(!found)return false;var el=found.shadowRoot.querySelector("button.action-main");if(!el)return false;el.click();return true;})()`);
await page.waitForTimeout(2000);
await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="SESSION-LIST")found=kids[i];}};visit(document);if(!found)return false;var el=found.shadowRoot.querySelector(".action-row .action-main");if(!el)return false;el.click();return true;})()`);
await page.waitForTimeout(2600);
const rows = await page.evaluate(probe);
console.log(JSON.stringify(rows, null, 1));
await browser.close();
