import { CATEGORIES, type Category } from '../shared/categories'

const EXTENSIONS: Record<Exclude<Category, 'other'>, string[]> = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', 'vob', '3gp'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'heif', 'tif', 'tiff', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'psd', 'svg', 'ico', 'avif'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff', 'mid', 'midi'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'rtf', 'md', 'csv', 'epub', 'mobi', 'pages', 'numbers', 'key', 'one', 'pst', 'ost'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'img', 'vhd', 'vhdx', 'vmdk', 'wim', 'esd', 'dmg', 'cab'],
  program: ['exe', 'dll', 'msi', 'msix', 'appx', 'ocx', 'cpl', 'scr', 'com', 'bat', 'cmd', 'ps1', 'jar', 'apk', 'node', 'pyd', 'so'],
  game: ['pak', 'vpk', 'bsa', 'ba2', 'forge', 'uasset', 'umap', 'ucas', 'utoc', 'bundle', 'assets', 'resource', 'resS', 'bik', 'bk2', 'wem', 'bnk', 'xnb', 'rpf', 'big', 'pck', 'arc', 'gcf', 'ncf', 'sav', 'esm', 'esp'],
  code: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'map', 'py', 'pyc', 'java', 'class', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'lua', 'swift', 'kt', 'json', 'yml', 'yaml', 'toml', 'xml', 'html', 'css', 'scss', 'pdb', 'lib', 'obj', 'o', 'a', 'pch', 'ipch', 'wasm', 'whl', 'nupkg', 'gem', 'crate'],
  system: ['sys', 'log', 'tmp', 'temp', 'dmp', 'etl', 'evtx', 'cat', 'mui', 'pf', 'msp', 'mum', 'manifest', 'blf', 'regtrans-ms', 'edb', 'jfm', 'chk', 'old', 'bak']
}

const BY_EXT = new Map<string, number>()
for (const [cat, exts] of Object.entries(EXTENSIONS)) {
  const index = CATEGORIES.indexOf(cat as Category)
  for (const e of exts) BY_EXT.set(e.toLowerCase(), index)
}

const SYSTEM = CATEGORIES.indexOf('system')

/** Category index of a file from its name (cheap: one lastIndexOf and a map lookup). */
export function categoryOf(name: string): number {
  const lower = name.toLowerCase()
  if (lower === 'pagefile.sys' || lower === 'hiberfil.sys' || lower === 'swapfile.sys') return SYSTEM
  const dot = lower.lastIndexOf('.')
  if (dot <= 0 || dot === lower.length - 1) return 0
  return BY_EXT.get(lower.slice(dot + 1)) ?? 0
}
