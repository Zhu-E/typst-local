// Converts the engine's HTML export into a Word document with pandoc.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './env.js';

/** pandoc from PANDOC_PATH, the project-local .pandoc/ (setup.sh), or PATH. */
function pandocPath() {
  if (process.env.PANDOC_PATH) return process.env.PANDOC_PATH;
  const local = path.join(ROOT, '.pandoc', 'bin', 'pandoc');
  return fs.existsSync(local) ? local : 'pandoc';
}

export class DocxUnavailableError extends Error {}

/**
 * Inline <svg> (equations drawn by html.frame) isn't understood by pandoc's
 * HTML reader, so each top-level <svg> becomes an <img> with an SVG data URI.
 */
function svgsToImages(html) {
  let out = '';
  let pos = 0;
  for (;;) {
    const start = html.indexOf('<svg', pos);
    if (start < 0) break;
    // Find the matching </svg>, allowing nested <svg> elements.
    let depth = 0;
    let i = start;
    let end = -1;
    while (i < html.length) {
      const open = html.indexOf('<svg', i);
      const close = html.indexOf('</svg>', i);
      if (close < 0) break;
      if (open >= 0 && open < close) {
        depth++;
        i = open + 4;
      } else {
        depth--;
        i = close + 6;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    let svg = html.slice(start, end);
    const head = svg.slice(0, svg.indexOf('>'));
    // Typst sizes frames with CSS (em); the viewBox is the real size in points.
    const box = /viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/.exec(head);
    const [w, h] = box ? [+box[1], +box[2]] : [null, null];
    let newHead = head.replace(/\s(width|height)="[^"]*"/g, '').replace(/\sstyle="[^"]*"/, '');
    if (!/xmlns=/.test(newHead)) newHead += ' xmlns="http://www.w3.org/2000/svg"';
    if (!/xmlns:xlink=/.test(newHead) && svg.includes('xlink:')) newHead += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    if (w) newHead += ` width="${w.toFixed(2)}pt" height="${h.toFixed(2)}pt"`;
    svg = newHead + svg.slice(head.length);
    const size = w ? ` width="${w.toFixed(2)}pt" height="${h.toFixed(2)}pt"` : '';
    // A framed picture (e.g. a screenshot with a template's drop shadow) goes in
    // as the plain raster image, which every Word-compatible app can show.
    const rasters = svg.includes('typst-text') ? [] : [...svg.matchAll(/data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)/g)];
    const raster = rasters.sort((a, b) => b[2].length - a[2].length)[0];
    const src = raster ? `data:image/${raster[1]};base64,${raster[2]}` : `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    out += html.slice(pos, start) + `<img alt=""${size} src="${src}">`;
    pos = end;
  }
  return out + html.slice(pos);
}

/** Converts exported HTML to a .docx buffer. */
export async function htmlToDocx(html) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'typst-local-docx-'));
  const output = path.join(tmp, 'out.docx');
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(pandocPath(), ['--from=html', '--to=docx', '--output', output], { stdio: ['pipe', 'ignore', 'pipe'] });
      const err = [];
      proc.stderr.on('data', (d) => err.push(d));
      proc.on('error', (e) =>
        reject(e.code === 'ENOENT' ? new DocxUnavailableError('pandoc is not installed on the server (re-run setup.sh)') : e),
      );
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('pandoc failed: ' + Buffer.concat(err).toString().slice(-500)))));
      proc.stdin.on('error', () => {});
      proc.stdin.end(svgsToImages(html));
    });
    return fs.readFileSync(output);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
