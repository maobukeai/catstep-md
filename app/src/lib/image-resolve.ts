/**
 * Shared image URL resolution for Catstep MD.
 * Used by Preview.vue, pdf-export.ts, image-export.ts, and docx-export.ts
 * to convert local image paths into URLs the webview can load or bytes for embedding.
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { readNote, readBinaryFile } from './commands';

/**
 * Whole-line image detection regex with optional title, bracketed path, and spaces in path.
 */
export const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(\s*<?([^>)]+?)>?(?:\s+["'][^"']*["'])?\s*\)\s*$/;

/**
 * Normalize a filesystem path so `convertFileSrc` produces a URL the
 * webview will actually load on every platform.
 *   1. Mixed `\` / `/` separators are unified.
 *   2. `./` and `../` segments are resolved.
 *   3. Windows drive prefixes (`C:`) survive normalization.
 */
export function normalizePath(p: string): string {
  if (!p) return p;
  let s = p.replace(/\\/g, '/');
  const driveMatch = s.match(/^([a-zA-Z]):\/(.*)$/);
  let prefix = '';
  let body = s;
  if (driveMatch) {
    prefix = driveMatch[1].toUpperCase() + ':/';
    body = driveMatch[2];
  } else if (s.startsWith('//')) {
    prefix = '//';
    body = s.slice(2);
  } else if (s.startsWith('/')) {
    prefix = '/';
    body = s.slice(1);
  }
  const out: string[] = [];
  for (const seg of body.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(seg);
  }
  return prefix + out.join('/');
}

const LOCAL_IMAGE_WITH_URL_SUFFIX =
  /^(.*?\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic|heif|ico))([?#].*)$/i;

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function encodeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeUriOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    try {
      return decodeURI(value);
    } catch {
      return value;
    }
  }
}

function stripLocalImageUrlSuffix(value: string): string {
  const match = LOCAL_IMAGE_WITH_URL_SUFFIX.exec(value);
  return match ? match[1] : value;
}

function fileUrlToPath(value: string): string {
  if (!/^file:\/\//i.test(value)) return value;
  const rest = value.slice('file://'.length);
  if (/^[a-zA-Z]:[\\/]/.test(rest)) return rest;
  if (rest.startsWith('/') && /^\/[a-zA-Z]:[\\/]/.test(rest)) return rest.slice(1);
  if (/^localhost\//i.test(rest)) return rest.slice('localhost/'.length);
  if (!rest.startsWith('/')) return `//${rest}`;
  return rest;
}

function cleanLocalImageSrc(src: string): string {
  const attr = decodeHtmlAttr(src.trim());
  const withoutUrlSuffix = stripLocalImageUrlSuffix(attr);
  return fileUrlToPath(decodeUriOnce(withoutUrlSuffix));
}

export function isLocalSvgPath(value: string): boolean {
  return /\.svg$/i.test(stripLocalImageUrlSuffix(value));
}

export function svgTextToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Resolve a local image src to an absolute filesystem path.
 * Returns the original src unchanged for remote/data/blob/asset URLs.
 */
export function resolveImagePath(
  src: string,
  imageRoot: string | null,
  filePath?: string,
): string {
  if (!src) return src;
  if (/^(https?|data|blob|asset|tauri):/i.test(src)) return src;

  let p = cleanLocalImageSrc(src);

  const isAbsolute = p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
  if (!isAbsolute) {
    let base: string | null = null;
    if (imageRoot) {
      const rootAbsolute = imageRoot.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(imageRoot);
      if (rootAbsolute) {
        base = imageRoot;
      } else if (filePath) {
        const dir = filePath.replace(/[\\/][^\\/]*$/, '');
        base = dir + '/' + imageRoot;
      }
    }
    if (!base && filePath) {
      base = filePath.replace(/[\\/][^\\/]*$/, '');
    }
    if (base) {
      p = base + '/' + p;
    }
  }

  return normalizePath(p);
}

/**
 * Resolve a single image src into something the webview can load.
 * Converts local paths to `asset://` URLs via Tauri's convertFileSrc().
 */
export function resolveImageSrc(
  src: string,
  imageRoot: string | null,
  filePath?: string,
): string {
  const resolved = resolveImagePath(src, imageRoot, filePath);
  // If it's still a remote/data/blob URL, return as-is
  if (/^(https?|data|blob|asset|tauri):/i.test(resolved)) return resolved;
  try {
    return convertFileSrc(resolved);
  } catch {
    return src;
  }
}

export function resolveImageSrcWithMeta(
  src: string,
  imageRoot: string | null,
  filePath?: string,
): { src: string; localPath: string | null } {
  if (!src || /^(https?|data|blob|asset|tauri):/i.test(src)) {
    return { src, localPath: null };
  }
  const localPath = resolveImagePath(src, imageRoot, filePath);
  if (/^(https?|data|blob|asset|tauri):/i.test(localPath)) {
    return { src: localPath, localPath: null };
  }
  try {
    return { src: convertFileSrc(localPath), localPath };
  } catch {
    return { src, localPath };
  }
}

/** Rewrite all `<img src=…>` URLs in the rendered markdown HTML. */
export function rewriteImageUrls(
  rawHtml: string,
  imageRoot: string | null,
  filePath?: string,
): string {
  return rawHtml.replace(
    /(<img[^>]*\bsrc=)(["'])([^"']*)\2/gi,
    (_match, prefix: string, q: string, src: string) => {
      // markdown-it percent-encodes non-ASCII in image URLs (`感` → `%E6%84%9F`).
      // Passing that straight to convertFileSrc encodes the `%` again, yielding
      // `%25E6…` — a double-encoded path that 404s, so images under a Chinese
      // (or space-containing) folder never load (顾河 report, Typora `./images/
      // <笔记名>/` paths). Decode the local path first so it's encoded exactly
      // once — mirroring rewriteLinkUrls. Remote/data/asset URLs are left alone.
      if (!src || /^(https?|data|blob|asset|tauri):/i.test(src)) {
        return `${prefix}${q}${src}${q}`;
      }
      const resolved = resolveImageSrcWithMeta(src, imageRoot, filePath);
      const nextPrefix = resolved.localPath && isLocalSvgPath(resolved.localPath)
        ? prefix.replace(/^<img\b/i, `<img data-solomd-local-src="${encodeHtmlAttr(resolved.localPath)}"`)
        : prefix;
      return `${nextPrefix}${q}${resolved.src}${q}`;
    },
  );
}

async function loadLocalSvgDataUrl(path: string): Promise<string | null> {
  try {
    const result = await readNote(path);
    const svg = result.content.trimStart();
    if (!svg.startsWith('<svg') && !svg.startsWith('<?xml')) return null;
    return svgTextToDataUrl(result.content);
  } catch {
    return null;
  }
}

export function installSvgImageFallbacks(root: ParentNode): void {
  const images = root.querySelectorAll<HTMLImageElement>('img[data-solomd-local-src]');
  for (const img of Array.from(images)) {
    if (img.dataset.solomdSvgFallbackBound === '1') continue;
    const path = img.dataset.solomdLocalSrc || '';
    if (!isLocalSvgPath(path)) continue;
    img.dataset.solomdSvgFallbackBound = '1';
    const fallback = async () => {
      if (img.src.startsWith('data:image/svg+xml')) return;
      const dataUrl = await loadLocalSvgDataUrl(path);
      if (dataUrl) img.src = dataUrl;
    };
    img.addEventListener('error', fallback, { once: true });
    if (img.complete && img.naturalWidth === 0) {
      void fallback();
    }
  }
}

/**
 * v4.3.0 issue #77 — local-file `<a href=…>` URLs in rendered markdown
 * resolve against the webview's base URL (`http://tauri.localhost/`),
 * which then bakes into exported PDFs / DOCX / images as a useless
 * `http://tauri.localhost/foo.factoryio` link.
 *
 * This rewrites local-file hrefs to absolute `file://` URLs so the link
 * (a) still works on the original machine and (b) shows a meaningful
 * file-system path when the PDF is shared. Remote schemes (http/https/
 * mailto/tel/data/etc.) and in-page anchors (`#section`) are left alone.
 */
export function rewriteLinkUrls(
  rawHtml: string,
  imageRoot: string | null,
  filePath?: string,
): string {
  return rawHtml.replace(
    /(<a\b[^>]*\bhref=)(["'])([^"']*)\2/gi,
    (_match, prefix: string, q: string, href: string) => {
      // Leave anchors / remote / data-style URLs as-is.
      if (!href) return `${prefix}${q}${q}`;
      if (href.startsWith('#')) return `${prefix}${q}${href}${q}`;
      if (/^(https?|mailto|tel|sms|data|blob|asset|tauri|ftp|file):/i.test(href)) {
        return `${prefix}${q}${href}${q}`;
      }
      // Decode the path so `%20` etc. don't go through resolution twice.
      let decoded: string;
      try { decoded = decodeURI(href); } catch { decoded = href; }
      const resolved = resolveImagePath(decoded, imageRoot, filePath);
      const isAbs = resolved.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(resolved);
      if (!isAbs) return `${prefix}${q}${href}${q}`;
      // Build a `file://` URL — encodeURI keeps the path readable while
      // escaping spaces / unicode. Windows drives need an extra `/`.
      const fileUrl = /^[a-zA-Z]:/.test(resolved)
        ? `file:///${encodeURI(resolved.replace(/\\/g, '/'))}`
        : `file://${encodeURI(resolved)}`;
      return `${prefix}${q}${fileUrl}${q}`;
    },
  );
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function mimeFromExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'ico': return 'image/x-icon';
    case 'avif': return 'image/avif';
    default: return 'image/png';
  }
}

export function assetUrlToPath(value: string): string | null {
  let rest = '';
  if (/^asset:\/\/localhost\//i.test(value)) {
    rest = value.slice('asset://localhost/'.length);
  } else if (/^asset:\/\//i.test(value)) {
    rest = value.slice('asset://'.length);
  } else if (/^https?:\/\/asset\.localhost\//i.test(value)) {
    rest = value.replace(/^https?:\/\/asset\.localhost\//i, '');
  } else {
    return null;
  }
  try {
    rest = decodeURIComponent(rest);
  } catch {}
  if (rest.startsWith('\\\\?\\')) {
    rest = rest.slice(4);
  }
  if (rest.startsWith('/') && /^\/[a-zA-Z]:[\\/]/.test(rest)) {
    rest = rest.slice(1);
  }
  // On POSIX, absolute paths start with '/' and must not be left relative.
  if (!rest.startsWith('/') && !/^[a-zA-Z]:/.test(rest)) {
    rest = '/' + rest;
  }
  return normalizePath(rest);
}

/**
 * Convert local image src attributes in rendered HTML into Base64 / Data URLs
 * for standalone HTML export, so standard browsers can view them without
 * encountering broken Tauri `asset://` URLs.
 */
export async function embedLocalImagesAsDataUrls(
  html: string,
  imageRoot: string | null,
  filePath?: string,
): Promise<string> {
  const imgRegex = /<img\b([^>]*?)\bsrc=(["'])([^"']*?)\2([^>]*?)>/gi;
  const matches = Array.from(html.matchAll(imgRegex));
  if (matches.length === 0) return html;

  const cache = new Map<string, string>();

  async function toDataUrl(src: string): Promise<string | null> {
    const assetPath = assetUrlToPath(src);
    if (!assetPath && (!src || /^(https?|data|blob):/i.test(src))) return null;
    const resolvedPath = assetPath ?? resolveImagePath(src, imageRoot, filePath);
    if (!resolvedPath || /^(https?|data|blob|asset|tauri):/i.test(resolvedPath)) return null;

    if (cache.has(resolvedPath)) {
      return cache.get(resolvedPath)!;
    }

    try {
      if (isLocalSvgPath(resolvedPath)) {
        const svgResult = await readNote(resolvedPath);
        const dataUrl = svgTextToDataUrl(svgResult.content);
        cache.set(resolvedPath, dataUrl);
        return dataUrl;
      }

      const binaryData = await readBinaryFile(resolvedPath);
      const bytes = new Uint8Array(binaryData);
      const mime = mimeFromExt(resolvedPath);
      const b64 = uint8ArrayToBase64(bytes);
      const dataUrl = `data:${mime};base64,${b64}`;
      cache.set(resolvedPath, dataUrl);
      return dataUrl;
    } catch {
      return null;
    }
  }

  let result = html;
  for (const match of matches) {
    const rawTag = match[0];
    const beforeSrc = match[1];
    const quote = match[2];
    const src = match[3];
    const afterSrc = match[4];

    const dataUrl = await toDataUrl(src);
    if (dataUrl) {
      const newTag = `<img${beforeSrc}src=${quote}${dataUrl}${quote}${afterSrc}>`;
      result = result.split(rawTag).join(newTag);
    }
  }

  return result;
}

