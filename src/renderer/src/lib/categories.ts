import { CATEGORIES, type Category } from '@shared/categories'

/**
 * Label and colors per file category: treemap cell + frame for each theme, and one mid-tone `chart`
 * color for bars and legends (readable on both backgrounds). Neighbors differ in lightness, not only hue.
 */
export const CATEGORY_INFO: Record<
  Category,
  { label: string; light: [string, string]; dark: [string, string]; chart: string }
> = {
  other: { label: 'Outros', light: ['#e4e4e7', '#d4d4d8'], dark: ['#3f3f46', '#27272a'], chart: '#a1a1aa' },
  video: { label: 'Vídeos', light: ['#fecaca', '#fca5a5'], dark: ['#7f1d1d', '#450a0a'], chart: '#f87171' },
  image: { label: 'Imagens', light: ['#fed7aa', '#fdba74'], dark: ['#7c2d12', '#431407'], chart: '#fb923c' },
  audio: { label: 'Áudio', light: ['#fbcfe8', '#f9a8d4'], dark: ['#831843', '#500724'], chart: '#f472b6' },
  document: { label: 'Documentos', light: ['#bfdbfe', '#93c5fd'], dark: ['#1e3a8a', '#172554'], chart: '#60a5fa' },
  archive: { label: 'Compactados', light: ['#ddd6fe', '#c4b5fd'], dark: ['#4c1d95', '#2e1065'], chart: '#a78bfa' },
  program: { label: 'Programas', light: ['#bbf7d0', '#86efac'], dark: ['#14532d', '#052e16'], chart: '#4ade80' },
  game: { label: 'Jogos', light: ['#fef08a', '#fde047'], dark: ['#713f12', '#422006'], chart: '#facc15' },
  code: { label: 'Desenvolvimento', light: ['#99f6e4', '#5eead4'], dark: ['#134e4a', '#042f2e'], chart: '#2dd4bf' },
  system: { label: 'Sistema', light: ['#d4d4d8', '#a1a1aa'], dark: ['#52525b', '#3f3f46'], chart: '#71717a' }
}

/** Mid-tone color for bars and legend dots. */
export function categoryChartColor(index: number | undefined): string {
  return CATEGORY_INFO[categoryAt(index)].chart
}

export function categoryAt(index: number | undefined): Category {
  return CATEGORIES[index ?? 0] ?? 'other'
}

/** [cell, frame] colors of a category for the current theme. */
export function categoryColors(index: number | undefined, dark: boolean): [string, string] {
  const info = CATEGORY_INFO[categoryAt(index)]
  return dark ? info.dark : info.light
}

/** Categories with their bytes, largest first, skipping empty ones. */
export function rankCategories(bytes: number[] | undefined): { index: number; key: Category; label: string; bytes: number }[] {
  if (!bytes) return []
  return bytes
    .map((b, index) => ({ index, key: categoryAt(index), label: CATEGORY_INFO[categoryAt(index)].label, bytes: b }))
    .filter((c) => c.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
}
