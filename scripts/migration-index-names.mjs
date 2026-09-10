import { Buffer } from 'node:buffer';

// Applied migrations keep their checksums. Only the fix-forward batch and later
// migrations must satisfy this new rule.
export const INDEX_NAME_CUTOFF = '20260926000600';
const MAX_IDENTIFIER_BYTES = 63;

/**
 * A small lexer for literal DDL, not a SQL parser. Preserve quoted identifiers
 * while ignoring comments and string literals. Only actual dollar-quoted DO
 * bodies are scanned for literal DDL; other dollar strings stay atomic, so an
 * apostrophe in their content cannot swallow a later statement. Function bodies
 * and dynamically constructed SQL require review; this guard never executes SQL.
 */
function tokens(sql) {
  const result = [];
  const keywordAt = (position, value) =>
    result[position]?.kind === 'word' && result[position].value.toUpperCase() === value;
  const expectsDoBody = () =>
    keywordAt(result.length - 1, 'DO') ||
    (keywordAt(result.length - 3, 'DO') &&
      keywordAt(result.length - 2, 'LANGUAGE') &&
      ['word', 'identifier'].includes(result.at(-1)?.kind));
  let position = 0;
  while (position < sql.length) {
    const rest = sql.slice(position);
    const whitespace = rest.match(/^\s+/);
    const dollarQuote = rest.match(/^\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/);
    if (whitespace) {
      position += whitespace[0].length;
    } else if (rest.startsWith('--')) {
      const newline = sql.indexOf('\n', position);
      position = newline === -1 ? sql.length : newline + 1;
    } else if (rest.startsWith('/*')) {
      position += 2;
      let depth = 1;
      while (position < sql.length && depth > 0) {
        if (sql.startsWith('/*', position)) {
          depth++;
          position += 2;
        } else if (sql.startsWith('*/', position)) {
          depth--;
          position += 2;
        } else position++;
      }
    } else if (dollarQuote) {
      const delimiter = dollarQuote[0];
      const start = position + delimiter.length;
      const closing = sql.indexOf(delimiter, start);
      const end = closing === -1 ? sql.length : closing;
      const body = sql.slice(start, end);
      const scanBody = expectsDoBody();
      result.push({ value: delimiter, kind: 'literal' });
      if (scanBody) {
        result.push(...tokens(body));
        result.push({ value: delimiter, kind: 'literal' });
      }
      position = closing === -1 ? sql.length : closing + delimiter.length;
    } else if (rest[0] === '"' || rest[0] === "'") {
      const quote = rest[0];
      const escapedString = quote === "'" && /(?:^|[^\w$])[eE]$/.test(sql.slice(0, position));
      position++;
      let value = '';
      while (position < sql.length) {
        const character = sql[position++];
        if (character === quote) {
          if (sql[position] !== quote) break;
          position++;
        } else if (escapedString && character === '\\') {
          position++;
        }
        value += character;
      }
      // Literal values act as a boundary, never as DDL keywords.
      result.push({ value, kind: quote === '"' ? 'identifier' : 'literal' });
    } else {
      const word = rest.match(/^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_$\u0080-\uFFFF]*/);
      const value = word ? word[0] : rest[0];
      result.push({ value, kind: word ? 'word' : 'symbol' });
      position += value.length;
    }
  }
  return result;
}

function decodeUnicodeIdentifier(value, escape) {
  let decoded = '';
  for (let position = 0; position < value.length; position++) {
    if (value[position] !== escape) {
      decoded += value[position];
    } else if (value[position + 1] === escape) {
      decoded += escape;
      position++;
    } else {
      const extended = value[position + 1] === '+';
      const start = position + (extended ? 2 : 1);
      const digits = extended ? 6 : 4;
      const hex = value.slice(start, start + digits);
      if (!new RegExp(`^[0-9a-f]{${digits}}$`, 'i').test(hex)) return null;
      const point = Number.parseInt(hex, 16);
      if (point > 0x10ffff) return null;
      decoded += String.fromCodePoint(point);
      position = start + digits - 1;
    }
  }
  return decoded;
}

export function overlongMigrationIndexNames(sql, migrationTimestamp) {
  if (migrationTimestamp < INDEX_NAME_CUTOFF) return [];
  const parts = tokens(sql);
  const keyword = (position, value) =>
    parts[position]?.kind === 'word' && parts[position].value.toUpperCase() === value;
  const problems = [];
  for (let position = 0; position < parts.length; position++) {
    if (!keyword(position, 'CREATE')) continue;
    let next = position + 1;
    if (keyword(next, 'UNIQUE')) next++;
    if (!keyword(next++, 'INDEX')) continue;
    if (keyword(next, 'CONCURRENTLY')) next++;
    if (keyword(next, 'IF') && keyword(next + 1, 'NOT') && keyword(next + 2, 'EXISTS')) {
      next += 3;
    }
    let identifier = parts[next];
    let afterIdentifier = next + 1;
    if (
      keyword(next, 'U') &&
      parts[next + 1]?.value === '&' &&
      parts[next + 2]?.kind === 'identifier'
    ) {
      afterIdentifier = next + 3;
      let escape = '\\';
      if (keyword(afterIdentifier, 'UESCAPE') && parts[afterIdentifier + 1]?.kind === 'literal') {
        escape = parts[afterIdentifier + 1].value;
        afterIdentifier += 2;
      }
      const value = decodeUnicodeIdentifier(parts[next + 2].value, escape);
      identifier = value === null ? null : { value, kind: 'identifier' };
    }
    if (
      !identifier ||
      !['identifier', 'word'].includes(identifier.kind) ||
      !keyword(afterIdentifier, 'ON')
    ) {
      continue;
    }
    const bytes = Buffer.byteLength(identifier.value, 'utf8');
    if (bytes > MAX_IDENTIFIER_BYTES) problems.push({ name: identifier.value, bytes });
  }
  return problems;
}
