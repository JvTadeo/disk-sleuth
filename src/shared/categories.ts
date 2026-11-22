/**
 * File categories. The scanner tags every file with one of these (by extension);
 * the window picks labels and colors by index.
 */
export const CATEGORIES = [
  'other',
  'video',
  'image',
  'audio',
  'document',
  'archive',
  'program',
  'game',
  'code',
  'system'
] as const

export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_COUNT = CATEGORIES.length
