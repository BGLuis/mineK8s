import { HighlightLanguage } from './file-types';

export type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'comment' | 'punct' | 'text';

export interface Token {
  kind: TokenKind;
  text: string;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const BOOLEAN = /^(true|false|null)$/;

function valueToken(raw: string): Token[] {
  if (raw === '') {
    return [];
  }
  const trimmed = raw.trim();
  const kind: TokenKind = BOOLEAN.test(trimmed)
    ? 'boolean'
    : NUMBER.test(trimmed)
      ? 'number'
      : 'string';
  return [{ kind, text: raw }];
}

function propertiesLine(line: string): Token[] {
  if (/^\s*[#!]/.test(line)) {
    return [{ kind: 'comment', text: line }];
  }
  const match = /^(\s*)([^=:\s][^=:]*?)(\s*[=:]\s*)(.*)$/.exec(line);
  if (!match) {
    return [{ kind: 'text', text: line }];
  }
  const [, indent, key, separator, value] = match;
  return [
    ...(indent ? [{ kind: 'text' as const, text: indent }] : []),
    { kind: 'key', text: key },
    { kind: 'punct', text: separator },
    ...valueToken(value),
  ];
}

function splitComment(line: string): [string, string] {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote && line[i - 1] !== '\\') {
        quote = '';
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return [line.slice(0, i), line.slice(i)];
    }
  }
  return [line, ''];
}

function yamlLine(line: string): Token[] {
  const [code, comment] = splitComment(line);
  const tokens: Token[] = [];
  const match = /^(\s*(?:-\s+)?)([^:\s][^:]*?)(:)(\s+.*|)$/.exec(code);
  if (match) {
    const [, lead, key, colon, rest] = match;
    if (lead) {
      tokens.push({ kind: 'punct', text: lead });
    }
    tokens.push({ kind: 'key', text: key }, { kind: 'punct', text: colon });
    const spaces = /^\s*/.exec(rest)?.[0] ?? '';
    if (spaces) {
      tokens.push({ kind: 'text', text: spaces });
    }
    tokens.push(...valueToken(rest.slice(spaces.length)));
  } else if (/^\s*-\s/.test(code)) {
    const lead = /^\s*-\s+/.exec(code)?.[0] ?? '';
    tokens.push({ kind: 'punct', text: lead }, ...valueToken(code.slice(lead.length)));
  } else if (code !== '') {
    tokens.push({ kind: 'text', text: code });
  }
  if (comment) {
    tokens.push({ kind: 'comment', text: comment });
  }
  return tokens;
}

function tomlLine(line: string): Token[] {
  const [code, comment] = splitComment(line);
  const tokens: Token[] = [];
  if (/^\s*\[.*\]\s*$/.test(code)) {
    tokens.push({ kind: 'key', text: code });
  } else {
    const match = /^(\s*)([^=\s][^=]*?)(\s*=\s*)(.*)$/.exec(code);
    if (match) {
      const [, indent, key, equals, value] = match;
      if (indent) {
        tokens.push({ kind: 'text', text: indent });
      }
      tokens.push({ kind: 'key', text: key }, { kind: 'punct', text: equals });
      const trailing = /\s*$/.exec(value)?.[0] ?? '';
      tokens.push(...valueToken(value.slice(0, value.length - trailing.length)));
      if (trailing) {
        tokens.push({ kind: 'text', text: trailing });
      }
    } else if (code !== '') {
      tokens.push({ kind: 'text', text: code });
    }
  }
  if (comment) {
    tokens.push({ kind: 'comment', text: comment });
  }
  return tokens;
}

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

function jsonLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of line.matchAll(JSON_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) {
      tokens.push({ kind: 'text', text: line.slice(last, start) });
    }
    const [, str, colon, num, word, punct] = match;
    if (str !== undefined) {
      tokens.push({ kind: colon ? 'key' : 'string', text: str });
      if (colon) {
        tokens.push({ kind: 'punct', text: colon });
      }
    } else if (num !== undefined) {
      tokens.push({ kind: 'number', text: num });
    } else if (word !== undefined) {
      tokens.push({ kind: 'boolean', text: word });
    } else if (punct !== undefined) {
      tokens.push({ kind: 'punct', text: punct });
    }
    last = start + match[0].length;
  }
  if (last < line.length) {
    tokens.push({ kind: 'text', text: line.slice(last) });
  }
  return tokens;
}

export function highlightLine(line: string, language: HighlightLanguage): Token[] {
  if (line === '') {
    return [];
  }
  switch (language) {
    case 'properties':
      return propertiesLine(line);
    case 'yaml':
      return yamlLine(line);
    case 'toml':
      return tomlLine(line);
    case 'json':
      return jsonLine(line);
    default:
      return [{ kind: 'text', text: line }];
  }
}

export function highlight(content: string, language: HighlightLanguage): Token[][] {
  return content.split('\n').map((line) => highlightLine(line.replace(/\r$/, ''), language));
}
