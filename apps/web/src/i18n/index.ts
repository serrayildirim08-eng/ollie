import en from './strings.en.json';
import enLiteral from './strings.en.literal.json';
import es from './strings.es.json';

const STRINGS = { en, 'en-literal': enLiteral, es } as const;

export type Locale = keyof typeof STRINGS;

export function getString(locale: Locale, path: string): string {
  const lookup = (root: unknown): string | undefined => {
    let node: unknown = root;
    for (const part of path.split('.')) {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return typeof node === 'string' ? node : undefined;
  };

  return lookup(STRINGS[locale]) ?? lookup(STRINGS.en) ?? path;
}
