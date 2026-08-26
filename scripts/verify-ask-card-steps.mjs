/**
 * Live check that a question card fits a phone with the keyboard open.
 *
 * The bug this exists for: the card laid every question out at once. On a
 * phone that made it taller than the screen, and the field being typed into
 * sat below the virtual keyboard - the only way to read your own answer was to
 * dismiss the keyboard, scroll, and open it again to keep editing.
 *
 * The viewport here is 375x360: a phone whose visible height has been taken by
 * the keyboard. One question per step has to fit in that, without falling back
 * to a scroller inside the card.
 *
 * Usage:
 *   node scripts/verify-ask-card-steps.mjs [--base-url http://127.0.0.1:8505]
 */
import { chromium } from "@playwright/test";

const baseUrl = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]
  : "http://127.0.0.1:8505";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 360 } });
const failures = [];
try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 20_000 });

  await page.evaluate(() => {
    const card = document.createElement("ask-user-card");
    card.draftSessionId = "local:probe";
    card.ask = {
      askId: "a1",
      askedAt: "",
      questions: [
        {
          id: "q1",
          question: "A question long enough to wrap on a narrow screen, with options that carry detail",
          options: [
            { value: "a", label: "First option", detail: "A supporting line that takes a couple of rows on a phone." },
            { value: "b", label: "Second option", detail: "Another supporting line of about the same length again." },
          ],
        },
        { id: "q2", question: "A second question", options: [] },
      ],
    };
    document.body.append(card);
  });
  await page.waitForTimeout(900);

  const measured = await page.evaluate(() => {
    const root = document.querySelector("ask-user-card")?.shadowRoot;
    const card = root?.querySelector(".card");
    if (!root || !card) return null;
    const scrollers = [...root.querySelectorAll("*")].filter((el) => {
      const style = getComputedStyle(el);
      return (style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
    });
    return {
      viewportHeight: window.innerHeight,
      cardHeight: Math.round(card.getBoundingClientRect().height),
      fieldsets: root.querySelectorAll("fieldset").length,
      buttons: [...root.querySelectorAll("button")].map((button) => button.textContent.trim()),
      innerScrollers: scrollers.length,
    };
  });

  if (measured === null) {
    failures.push("could not mount an ask-user-card");
  } else {
    if (measured.fieldsets !== 1) {
      failures.push(`expected one question on screen, saw ${String(measured.fieldsets)}`);
    }
    if (measured.cardHeight > measured.viewportHeight) {
      failures.push(
        `card is ${String(measured.cardHeight)}px tall in a ${String(measured.viewportHeight)}px viewport, `
        + "so the answer field is under the keyboard",
      );
    }
    if (measured.innerScrollers > 0) {
      failures.push(`card has ${String(measured.innerScrollers)} scroll region(s) of its own`);
    }
    if (!measured.buttons.includes("Next")) {
      failures.push(`expected a Next control, saw ${measured.buttons.join(", ")}`);
    }
    console.log(
      `card=${String(measured.cardHeight)}px viewport=${String(measured.viewportHeight)}px `
      + `questions-on-screen=${String(measured.fieldsets)} inner-scrollers=${String(measured.innerScrollers)} `
      + `buttons=${measured.buttons.join("/")}`,
    );
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error("FAIL");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("PASS");
