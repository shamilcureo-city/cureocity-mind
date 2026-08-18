import { describe, expect, it } from 'vitest';
import { serializeJsonForHtml } from './html-safe-json';

describe('serializeJsonForHtml', () => {
  it('prevents a JSON-LD value from closing its script element', () => {
    const value = { name: '</script><script>alert(1)</script>' };

    const serialized = serializeJsonForHtml(value);

    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<');
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it('escapes JavaScript line separator characters while preserving the JSON value', () => {
    const value = { text: 'before\u2028between\u2029after' };

    const serialized = serializeJsonForHtml(value);

    expect(serialized).not.toContain('\u2028');
    expect(serialized).not.toContain('\u2029');
    expect(JSON.parse(serialized)).toEqual(value);
  });
});
