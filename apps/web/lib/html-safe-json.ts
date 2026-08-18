/** Serialize structured data for embedding inside an HTML script element. */
export function serializeJsonForHtml(value: object): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
