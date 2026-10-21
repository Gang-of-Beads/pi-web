/**
 * The access gate's sign-in page: server-rendered, no app bundle, no script, inline CSS that follows
 * the reader's color scheme. One password field with a fixed hidden username, so password managers
 * store the token. Every link and form target is relative, because the page is always served at the
 * app's base and the server never knows the reverse proxy's prefix.
 */

export const SIGN_IN_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** What the page says above the form. */
export type SignInNotice = "none" | "wrong-token" | "throttled-address" | "throttled-overall";

const NOTICE_TEXT: Readonly<Record<SignInNotice, string | undefined>> = {
  none: undefined,
  "wrong-token": "That access token is not right.",
  "throttled-address": "Too many wrong attempts from this address. Wait a few minutes, then try again.",
  "throttled-overall": "Too many wrong attempts from every address together, so sign-in is paused for everyone. Wait a few minutes, then try again.",
};

export interface SignInPageFacts {
  readonly signedIn: boolean;
  readonly notice: SignInNotice;
  /** The app's query to return to after signing in; already normalized. */
  readonly next: string;
  /** Plain HTTP to a name that is not loopback: the token travels unencrypted unless the network encrypts it. */
  readonly unencrypted: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => `&#${String(character.charCodeAt(0))};`);
}

/**
 * The app's own palette and control rules (the core theme in `src/client/index.html`): dark by default and the same hue's light side under
 * `prefers-color-scheme`, no script; a tonal card with a 1 px border on the canvas; controls drawn
 * 36 px with an 8 px radius, reaching 44 px on a finger; the accent kept for the one action; status as
 * a 6 px dot and words in the tone colour. Copied values, not links to the app's stylesheet: the page
 * is served before sign-in and must load nothing else.
 */
const STYLE = `
:root {
  color-scheme: dark light;
  --bg: #141218; --card: #1d1b20; --field: #141218; --border: #48454e; --border-muted: #36343b;
  --text: #e6e0e9; --bright: #f5eef7; --secondary: #cac4d0; --muted: #938f99;
  --accent: #d0bcff; --on-accent: #381e72; --selection: #4a4458;
  --danger: #f2b8b5; --warning: #ffb871; --success: #8bd4a0;
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-display: "SF Pro Display", "Segoe UI Variable Display", Inter, "Helvetica Neue", ui-sans-serif, system-ui, sans-serif;
  --text-sm: 13px; --text-base: 14px; --text-lg: 17px;
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --bg: #fdf7ff; --card: #f3edf7; --field: #fdf7ff; --border: #cac4d0; --border-muted: #e0dbe8;
    --text: #1d1b20; --bright: #111014; --secondary: #49454f; --muted: #6f6b76;
    --accent: #6750a4; --on-accent: #ffffff; --selection: #e8def8;
    --danger: #b3261e; --warning: #8a5300; --success: #1e6b3a;
  }
}
@media (max-width: 640px) { :root { --text-sm: 12px; --text-base: 13px; --text-lg: 15px; } }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font: var(--text-base)/1.45 var(--font-ui); -webkit-tap-highlight-color: transparent; }
body { min-height: 100dvh; display: grid; place-items: center; padding: 16px 8px; }
main { width: min(360px, 100%); display: grid; gap: 16px; padding: 20px 16px; background: var(--card); border: 1px solid var(--border-muted); border-radius: 12px; }
header { display: flex; align-items: center; gap: 8px; }
header img { width: 20px; height: 20px; }
h1 { margin: 0; color: var(--bright); font: 600 var(--text-lg)/1.25 var(--font-display); }
p { margin: 0; }
.lead { color: var(--secondary); font-size: var(--text-sm); }
form { display: grid; gap: 12px; margin: 0; }
label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 600; }
input[type=password] { width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--field); color: var(--text); font: 16px var(--font-ui); }
input[type=password]:focus-visible, .key:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.key { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 36px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); font: 600 var(--text-sm) var(--font-ui); text-decoration: none; cursor: pointer; }
.key.primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
@media (hover: hover) { .key:hover { background: var(--selection); } .key.primary:hover { filter: brightness(1.08); background: var(--accent); } }
@media (pointer: coarse) { .key::after { content: ""; position: absolute; inset: -4px 0; } }
.status { display: flex; align-items: baseline; gap: 8px; font-size: var(--text-sm); }
.status::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; transform: translateY(-1px); }
.status.danger { color: var(--danger); }
.status.success { color: var(--success); }
.status.warning::before { background: var(--warning); }
.status.warning { color: var(--secondary); }
.actions { display: grid; gap: 8px; }
`;

/**
 * The page's referrer policy is `same-origin`, never `no-referrer`: under `no-referrer` a browser
 * sends `Origin: null` on the page's own form posts, and over plain HTTP to a name that is not loopback
 * (no Fetch Metadata) the sign-in route then refuses them as another site's (review 2026-10-21, F1).
 * `same-origin` still sends no `Referer` to any other site.
 */
function document(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="same-origin">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#141218" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#fdf7ff" media="(prefers-color-scheme: light)">
<title>Sign in · PI WEB</title>
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<style>${STYLE}</style>
</head>
<body>
<main>
<header><img src="favicon.svg" alt=""><h1>PI WEB</h1></header>
${body}
</main>
</body>
</html>
`;
}

function noticeBlock(notice: SignInNotice): string {
  const text = NOTICE_TEXT[notice];
  return text === undefined ? "" : `<p class="status danger" role="alert">${escapeHtml(text)}</p>`;
}

function unencryptedBlock(unencrypted: boolean): string {
  return unencrypted ? `<p class="status warning">This connection is plain HTTP: the token travels unencrypted unless the network between you and this machine encrypts it.</p>` : "";
}

function appHref(next: string): string {
  return next === "" ? "./" : `./?${next}`;
}

function signedInBody(facts: SignInPageFacts): string {
  return `<p class="status success" role="status">Signed in on this browser.</p>
<div class="actions">
<a class="key primary" href="${escapeHtml(appHref(facts.next))}">Open PI WEB</a>
<form method="post" action="access">
<input type="hidden" name="intent" value="sign-out">
<button class="key" type="submit">Sign out</button>
</form>
</div>`;
}

function signInBody(facts: SignInPageFacts): string {
  return `<p class="lead">This PI WEB asks for its access token.</p>
${noticeBlock(facts.notice)}
${unencryptedBlock(facts.unencrypted)}
<form method="post" action="access">
<input type="text" name="username" value="pi-web" autocomplete="username" hidden>
<input type="hidden" name="next" value="${escapeHtml(facts.next)}">
<label>Access token
<input type="password" name="token" autocomplete="current-password" required autofocus>
</label>
<button class="key primary" type="submit">Sign in</button>
</form>`;
}

export function signInPage(facts: SignInPageFacts): string {
  return document(facts.signedIn ? signedInBody(facts) : signInBody(facts));
}
