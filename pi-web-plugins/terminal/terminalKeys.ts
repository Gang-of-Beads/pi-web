export type TerminalSoftKeyId =
  | "escape"
  | "tab"
  | "ctrl-c"
  | "ctrl-d"
  | "ctrl-z"
  | "ctrl-l"
  | "ctrl-r"
  | "ctrl-u"
  | "ctrl-w"
  | "arrow-left"
  | "arrow-up"
  | "arrow-down"
  | "arrow-right"
  | "home"
  | "end"
  | "page-up"
  | "page-down"
  | "delete"
  | "backspace"
  | "meta-backward-word"
  | "meta-forward-word";

export interface TerminalModesSnapshot {
  applicationCursorKeysMode: boolean;
}

const ESC = "\x1b";
const DEL = "\x7f";

export function terminalSoftKeySequence(key: TerminalSoftKeyId, modes?: TerminalModesSnapshot): string {
  switch (key) {
    case "escape": return ESC;
    case "tab": return "\t";
    case "ctrl-c": return controlSequence("c");
    case "ctrl-d": return controlSequence("d");
    case "ctrl-z": return controlSequence("z");
    case "ctrl-l": return controlSequence("l");
    case "ctrl-r": return controlSequence("r");
    case "ctrl-u": return controlSequence("u");
    case "ctrl-w": return controlSequence("w");
    case "arrow-left": return cursorSequence("D", modes);
    case "arrow-up": return cursorSequence("A", modes);
    case "arrow-down": return cursorSequence("B", modes);
    case "arrow-right": return cursorSequence("C", modes);
    case "home": return cursorEndpointSequence("H", modes);
    case "end": return cursorEndpointSequence("F", modes);
    case "page-up": return `${ESC}[5~`;
    case "page-down": return `${ESC}[6~`;
    case "delete": return `${ESC}[3~`;
    case "backspace": return DEL;
    case "meta-backward-word": return `${ESC}b`;
    case "meta-forward-word": return `${ESC}f`;
  }
}

function controlSequence(letter: string): string {
  return String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64);
}

function cursorSequence(code: "A" | "B" | "C" | "D", modes: TerminalModesSnapshot | undefined): string {
  return modes?.applicationCursorKeysMode === true ? `${ESC}O${code}` : `${ESC}[${code}`;
}

function cursorEndpointSequence(code: "F" | "H", modes: TerminalModesSnapshot | undefined): string {
  return modes?.applicationCursorKeysMode === true ? `${ESC}O${code}` : `${ESC}[${code}`;
}
