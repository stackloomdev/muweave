export const DEFAULT_FONT_FAMILY = 'Noto Sans SC';

export const BUILTIN_FONTS = [
  { family: DEFAULT_FONT_FAMILY, label: 'Noto Sans SC' },
  { family: 'Roboto', label: 'Roboto' },
] as const;

// Keep saved projects and undo history readable after replacing the bundled fonts.
export function normalizeFontFamily(family: string): string {
  if (family === 'Noto Sans SC Variable') return DEFAULT_FONT_FAMILY;
  if (family === 'Manrope Variable' || family === 'Manrope') return 'Roboto';
  return family;
}

export function isBuiltinFont(family: string): boolean {
  return BUILTIN_FONTS.some((font) => font.family === normalizeFontFamily(family));
}
