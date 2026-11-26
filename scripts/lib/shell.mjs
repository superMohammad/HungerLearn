// @ts-check
/**
 * Enough shell lexing for the agent guard to see what a command line will run. Each simple command becomes
 * its words with quotes removed (`"gh"` and `g"h"` are the word gh; a quoted message stays one word), split on
 * `&& || ; | & ( )` and newlines outside quotes. Redirections (`2>&1`, `> file`) are not words. Code inside
 * `$(…)` (scanned with these same rules, so heredocs and quotes inside it work), backticks (bash), unquoted
 * heredocs and PowerShell `@"…"@` here-strings is returned as nested command text, for the caller to check
 * the same way. Heredoc bodies are also kept per command (a shell reading its stdin runs them), and each
 * command records whether a pipe feeds it. Comments are skipped (`#…`, PowerShell `<#…#>`); `$((…))` is arithmetic, but `$(…)` inside it is code.
 * Two dialects: BASH (Claude Code, Git Bash) and POWERSHELL (Codex on Windows): the guard checks both.
 * Anything that does not close (quote, substitution, heredoc) returns null so the caller can fail closed;
 * the POWERSHELL reading also returns null on an unquoted `<`, which PowerShell itself rejects.
 */

/**
 * @typedef {{
 *   escape: string;            // escape character outside single quotes
 *   ansiC: boolean;            // $'…' strings with backslash escapes
 *   doubledQuotes: boolean;    // '' inside '…' and "" inside "…" are literal quotes
 *   backtickCode: boolean;     // `…` is command substitution
 *   heredocs: boolean;         // <<DELIM … DELIM and <<< here-strings
 *   hereStrings: boolean;      // PowerShell @"…"@ and @'…'@
 * }} Dialect
 */
/** @type {Dialect} */
export const BASH = { escape: "\\", ansiC: true, doubledQuotes: false, backtickCode: true, heredocs: true, hereStrings: false };
/** @type {Dialect} */
export const POWERSHELL = { escape: "`", ansiC: false, doubledQuotes: true, backtickCode: false, heredocs: false, hereStrings: true };

/** @typedef {{ commands: string[][]; piped: boolean[]; stdin: string[][]; nested: string[] }} Parsed */

const SEPARATORS = ["&&", "||", "|&", ";", "|", "&", "\n"];
const REDIRECTION = /^(&>>|&>|>>|>&|<&|>\||<>|>|<)(\d+|-)?/;

/**
 * Index just past the `))` closing arithmetic `$((` whose body starts at `start`, or -1.
 * @param {string} text @param {number} start
 */
function arithmeticEnd(text, start) {
  let depth = 2;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Scan `text` from `start`. At top level it runs to the end; inside `$(…)` (`inSub`) it stops after the `)`
 * that closes the substitution and reports where.
 * @param {string} text @param {number} start @param {Dialect} d @param {boolean} inSub
 * @returns {{ parsed: Parsed; end: number } | null}
 */
function scan(text, start, d, inSub) {
  /** @type {string[][]} */
  const commands = [];
  /** @type {boolean[]} */
  const piped = [];
  /** @type {Map<number, string[]>} */
  const stdin = new Map();
  /** @type {string[]} */
  const nested = [];
  /** @type {{ delimiter: string; quoted: boolean; tabs: boolean; command: number }[]} */
  let heredocs = [];
  /** @type {string[]} */
  let words = [];
  let word = "";
  let inWord = false;
  let dropNextWord = false;
  let stdinNextWord = false;
  let pipedNext = false;
  let depth = 0;

  const endWord = () => {
    if (inWord && stdinNextWord) stdin.set(commands.length, [...(stdin.get(commands.length) ?? []), word]);
    else if (inWord && !dropNextWord) words.push(word);
    if (inWord) {
      dropNextWord = false;
      stdinNextWord = false;
    }
    word = "";
    inWord = false;
  };
  /** @param {string} separator */
  const endCommand = (separator) => {
    endWord();
    dropNextWord = false;
    stdinNextWord = false;
    if (words.length > 0) {
      commands.push(words);
      piped.push(pipedNext);
    }
    words = [];
    pipedNext = separator === "|" || separator === "|&";
  };
  /** Code in `$(…)` starting at `at` (just past `$(`); null when it never closes. @param {string} source @param {number} at */
  const substitution = (source, at) => {
    const sub = scan(source, at, d, true);
    if (sub === null) return null;
    nested.push(source.slice(at, sub.end - 1));
    return sub.end;
  };
  /**
   * Collect `$(…)` and backtick code from an unquoted heredoc, an `@"…"@` body or an arithmetic body.
   * @param {string} body @returns {boolean} false when something in it never closes
   */
  const codeIn = (body) => {
    for (let k = 0; k < body.length; k += 1) {
      if (body[k] === d.escape) k += 1;
      else if (body.startsWith("$((", k)) {
        const end = arithmeticEnd(body, k + 3);
        if (end < 0 || !codeIn(body.slice(k + 3, end - 2))) return false;
        k = end - 1;
      } else if (body.startsWith("$(", k)) {
        const end = substitution(body, k + 2);
        if (end === null) return false;
        k = end - 1;
      } else if (d.backtickCode && body[k] === "`") {
        const close = body.indexOf("`", k + 1);
        if (close < 0) return false;
        nested.push(body.slice(k + 1, close));
        k = close;
      }
    }
    return true;
  };
  /**
   * A quoted span from `at` up to `quote`; `code` collects `$(…)`/backticks inside (double quotes).
   * @param {number} at @param {string} quote @param {boolean} escapes @param {boolean} code
   * @returns {{ end: number; value: string } | null}
   */
  const quoted = (at, quote, escapes, code) => {
    let value = "";
    for (let i = at; i < text.length; i += 1) {
      const ch = text[i];
      if (escapes && ch === d.escape && i + 1 < text.length) {
        value += text[i + 1];
        i += 1;
      } else if (ch === quote && d.doubledQuotes && text[i + 1] === quote) {
        value += quote;
        i += 1;
      } else if (ch === quote) {
        return { end: i + 1, value };
      } else if (code && text.startsWith("$((", i)) {
        const end = arithmeticEnd(text, i + 3);
        if (end < 0 || !codeIn(text.slice(i + 3, end - 2))) return null;
        value += text.slice(i, end);
        i = end - 1;
      } else if (code && text.startsWith("$(", i)) {
        const end = substitution(text, i + 2);
        if (end === null) return null;
        value += text.slice(i, end);
        i = end - 1;
      } else if (code && d.backtickCode && ch === "`") {
        const close = text.indexOf("`", i + 1);
        if (close < 0) return null;
        nested.push(text.slice(i + 1, close));
        value += text.slice(i, close + 1);
        i = close;
      } else value += ch;
    }
    return null;
  };
  /** Skip the pending heredoc bodies that start at `at`; null when one never ends. @param {number} at */
  const readHeredocs = (at) => {
    let i = at;
    for (const doc of heredocs) {
      const bodyStart = i;
      let bodyEnd = -1;
      while (bodyEnd < 0) {
        if (i >= text.length) return null;
        const newline = text.indexOf("\n", i);
        const lineEnd = newline < 0 ? text.length : newline;
        const line = text.slice(i, lineEnd).replace(/\r$/, "");
        if ((doc.tabs ? line.replace(/^\t+/, "") : line) === doc.delimiter) bodyEnd = i;
        i = lineEnd + 1;
      }
      const body = text.slice(bodyStart, bodyEnd);
      stdin.set(doc.command, [...(stdin.get(doc.command) ?? []), body]);
      if (!doc.quoted && !codeIn(body)) return null;
    }
    heredocs = [];
    return i;
  };

  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === d.escape) {
      if (text[i + 1] !== "\n") {
        word += text[i + 1] ?? "";
        inWord = true;
      }
      i += 2;
      continue;
    }
    if (ch === "#" && !inWord) {
      const newline = text.indexOf("\n", i);
      i = newline < 0 ? text.length : newline;
      continue;
    }
    if (d.heredocs && text.startsWith("<<<", i)) {
      endWord();
      stdinNextWord = true;
      i += 3;
      continue;
    }
    if (d.heredocs && text.startsWith("<<", i)) {
      endWord();
      let j = i + 2;
      const tabs = text[j] === "-";
      if (tabs) j += 1;
      while (text[j] === " " || text[j] === "\t") j += 1;
      const match = /^(\\?)(['"]?)([\w.-]+)\2/.exec(text.slice(j));
      if (match === null) return null;
      heredocs.push({ delimiter: match[3], quoted: match[1] !== "" || match[2] !== "", tabs, command: commands.length });
      i = j + match[0].length;
      continue;
    }
    if (d.hereStrings && text.startsWith("<#", i)) {
      const close = text.indexOf("#>", i + 2);
      if (close < 0) return null;
      i = close + 2;
      continue;
    }
    if (!d.heredocs && ch === "<") return null;
    if (d.hereStrings && ch === "@" && (text[i + 1] === '"' || text[i + 1] === "'") && /^\r?\n/.test(text.slice(i + 2))) {
      const quote = text[i + 1];
      const close = text.indexOf(`\n${quote}@`, i + 2);
      if (close < 0) return null;
      const body = text.slice(i + 2, close);
      if (quote === '"' && !codeIn(body)) return null;
      word += body;
      inWord = true;
      i = close + 3;
      continue;
    }
    const ansi = d.ansiC && ch === "$" && text[i + 1] === "'";
    if (ansi || ch === "'" || ch === '"') {
      const quote = ansi ? "'" : ch;
      const read = quoted(ansi ? i + 2 : i + 1, quote, ansi || ch === '"', ch === '"');
      if (read === null) return null;
      word += read.value;
      inWord = true;
      i = read.end;
      continue;
    }
    if (text.startsWith("$((", i)) {
      const end = arithmeticEnd(text, i + 3);
      if (end < 0 || !codeIn(text.slice(i + 3, end - 2))) return null;
      word += text.slice(i, end);
      inWord = true;
      i = end;
      continue;
    }
    if (text.startsWith("$(", i)) {
      const end = substitution(text, i + 2);
      if (end === null) return null;
      word += text.slice(i, end);
      inWord = true;
      i = end;
      continue;
    }
    if (d.backtickCode && ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close < 0) return null;
      nested.push(text.slice(i + 1, close));
      word += text.slice(i, close + 1);
      inWord = true;
      i = close + 1;
      continue;
    }
    const redirection = ch === ">" || ch === "<" || text.startsWith("&>", i) ? REDIRECTION.exec(text.slice(i)) : null;
    if (redirection !== null) {
      // `2>` is a file descriptor, not a word; any other word ends here (`main>log` is the word main).
      if (/^\d+$/.test(word)) {
        word = "";
        inWord = false;
      } else endWord();
      dropNextWord = redirection[2] === undefined;
      i += redirection[0].length;
      continue;
    }
    if (ch === ")" && inSub && depth === 0) {
      if (heredocs.length > 0) return null;
      endCommand(")");
      return { parsed: { commands, piped, stdin: commands.map((_, k) => stdin.get(k) ?? []), nested }, end: i + 1 };
    }
    if (ch === "(" || ch === ")") {
      depth += ch === "(" ? 1 : -1;
      endCommand(ch);
      i += 1;
      continue;
    }
    const separator = SEPARATORS.find((s) => text.startsWith(s, i));
    if (separator !== undefined) {
      endCommand(separator);
      i += separator.length;
      if (separator === "\n" && heredocs.length > 0) {
        const after = readHeredocs(i);
        if (after === null) return null;
        i = after;
      }
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") endWord();
    else {
      word += ch;
      inWord = true;
    }
    i += 1;
  }
  if (inSub || heredocs.length > 0) return null;
  endCommand("");
  return { parsed: { commands, piped, stdin: commands.map((_, k) => stdin.get(k) ?? []), nested }, end: text.length };
}

/** @param {string} command @param {Dialect} d @returns {Parsed | null} */
export function parseCommand(command, d) {
  const result = scan(command, 0, d, false);
  return result === null ? null : result.parsed;
}
