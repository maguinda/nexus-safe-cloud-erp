/** Texto seguro para XML y HTML: se escapan los cinco caracteres especiales y se quitan los que XML 1.0 no admite (controles, sustitutos sueltos). */
export function xmlEscape(v: string): string {
  return v
    .replace(/[^\u0009\u000a\u000d -퟿-�\u{10000}-\u{10ffff}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
