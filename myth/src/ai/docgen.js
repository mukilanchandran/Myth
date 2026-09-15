// Document generation & reading for the assistant. Myth can write a file for
// you (PDF, Markdown, text, CSV, JSON, HTML) and read the ones you hand it
// (PDF text, plain text formats). No third-party PDF writer — the writer
// below emits a small, valid, text-only PDF with page breaks, headings and
// bullet lines, which is all a study sheet or a brief needs.

// ---------- formats ----------
export const FORMATS = {
  pdf: { ext: 'pdf', mime: 'application/pdf', label: 'PDF' },
  md: { ext: 'md', mime: 'text/markdown', label: 'Markdown' },
  markdown: { ext: 'md', mime: 'text/markdown', label: 'Markdown' },
  txt: { ext: 'txt', mime: 'text/plain', label: 'Text' },
  text: { ext: 'txt', mime: 'text/plain', label: 'Text' },
  csv: { ext: 'csv', mime: 'text/csv', label: 'CSV' },
  json: { ext: 'json', mime: 'application/json', label: 'JSON' },
  html: { ext: 'html', mime: 'text/html', label: 'HTML' },
  doc: { ext: 'md', mime: 'text/markdown', label: 'Markdown' },
  document: { ext: 'md', mime: 'text/markdown', label: 'Markdown' },
  notes: { ext: 'md', mime: 'text/markdown', label: 'Markdown' },
  note: { ext: 'md', mime: 'text/markdown', label: 'Markdown' },
};
export const normalizeFormat = (f) => (FORMATS[String(f ?? '').toLowerCase().trim()] ? String(f).toLowerCase().trim() : 'md');

const safeName = (s) =>
  String(s ?? 'document').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document';

/** Build a file name with the right extension. */
export function fileNameFor(title, format) {
  const f = FORMATS[normalizeFormat(format)];
  const base = safeName(title).replace(new RegExp(`\\.${f.ext}$`, 'i'), '');
  return `${base}.${f.ext}`;
}

// ---------- PDF writer ----------
// Characters outside WinAnsi are mapped to close ASCII so the built-in
// Helvetica renders them; the byte offsets in the xref stay exact because the
// output is pure 8-bit.
const ASCII_MAP = [
  [/₹/g, 'Rs.'], [/[–—]/g, '-'], [/[‘’]/g, "'"], [/[“”]/g, '"'], [/…/g, '...'], [/•/g, '-'], [/→/g, '->'], [/←/g, '<-'],
  [/✓|✔/g, '[x]'], [/[   ]/g, ' '], [/°/g, ' deg'], [/×/g, 'x'], [/[^\x09\x0A\x0D\x20-\x7E]/g, '?'],
];
const toAscii = (s) => ASCII_MAP.reduce((acc, [rx, rep]) => acc.replace(rx, rep), String(s ?? ''));
const pdfEscape = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// Approximate Helvetica advance widths (per 1000 em) for wrapping.
const W = { ' ': 278, i: 222, l: 222, j: 222, t: 278, f: 278, r: 333, I: 278, '.': 278, ',': 278, ':': 278, ';': 278, "'": 191, '!': 278, m: 833, w: 722, M: 833, W: 944 };
const width = (s, size) => { let w = 0; for (const ch of s) w += W[ch] ?? (ch >= 'A' && ch <= 'Z' ? 667 : 556); return (w / 1000) * size; };

function wrap(text, size, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (width(cand, size) <= maxW) line = cand;
      else {
        if (line) out.push(line);
        // a single word longer than the line gets hard-cut
        let rest = w;
        while (width(rest, size) > maxW && rest.length > 1) {
          let cut = rest.length;
          while (cut > 1 && width(rest.slice(0, cut), size) > maxW) cut--;
          out.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Make a simple PDF from a title and body. The body may use light Markdown:
 * "# Heading", "## Sub", "- bullet" and blank-line paragraphs.
 * Returns a Blob (application/pdf).
 */
export function makePdf(title, body) {
  const PAGE_W = 595.28, PAGE_H = 841.89, M = 56;
  const maxW = PAGE_W - 2 * M;
  const pages = [];
  let ops = [];
  let y = PAGE_H - M;
  const newPage = () => { if (ops.length) pages.push(ops); ops = []; y = PAGE_H - M; };
  const ensure = (h) => { if (y - h < M) newPage(); };
  const put = (line, size, bold, indent = 0) => {
    ensure(size * 1.4);
    y -= size * 1.15;
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${(M + indent).toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(line)}) Tj ET`);
    y -= size * 0.3;
  };
  const text = (t, size, bold, indent = 0, prefix = '') => {
    const pw = prefix ? width(prefix, size) : 0;
    const lines = wrap(toAscii(t), size, maxW - indent - pw);
    lines.forEach((l, i) => {
      if (prefix && i === 0) {
        ensure(size * 1.4);
        ops.push(`BT /F1 ${size} Tf ${(M + indent).toFixed(2)} ${(y - size * 1.15).toFixed(2)} Td (${pdfEscape(prefix)}) Tj ET`);
      }
      put(l, size, bold, indent + pw);
    });
  };

  if (title) { text(title, 20, true); y -= 6; }
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { y -= 6; continue; }
    let m;
    if ((m = line.match(/^#{1,2}\s+(.*)$/))) { y -= 4; text(m[1], line.startsWith('##') ? 13 : 15, true); }
    else if ((m = line.match(/^#{3,6}\s+(.*)$/))) { text(m[1], 11.5, true); }
    else if ((m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/))) { text(m[1].replace(/\*\*(.*?)\*\*/g, '$1'), 11, false, 14, '- '); }
    else text(line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1'), 11, false);
  }
  if (ops.length) pages.push(ops);
  if (!pages.length) pages.push([`BT /F1 11 Tf ${M} ${PAGE_H - M} Td ( ) Tj ET`]);

  // objects: 1 catalog, 2 pages, 3 F1, 4 F2, then (content, page) pairs
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages placeholder, filled once the page ids are known
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (const p of pages) {
    const stream = p.join('\n');
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

// ---------- any format ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function markdownToHtml(md) {
  const lines = String(md).split('\n');
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const l of lines) {
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { closeList(); out.push(`<h${m[1].length}>${esc(m[2])}</h${m[1].length}>`); }
    else if ((m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/))) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${esc(m[1]).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')}</li>`); }
    else if (!l.trim()) closeList();
    else { closeList(); out.push(`<p>${esc(l).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')}</p>`); }
  }
  closeList();
  return out.join('\n');
}

/** Turn a title + body into a Blob of the requested format. */
export function makeDocument({ title, body, format }) {
  const fmt = normalizeFormat(format);
  const f = FORMATS[fmt];
  const name = fileNameFor(title, fmt);
  let blob;
  if (f.ext === 'pdf') blob = makePdf(title, body);
  else if (f.ext === 'html') {
    blob = new Blob([
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.55;color:#16281f}h1{font-size:28px}h2{font-size:20px;margin-top:28px}li{margin:4px 0}</style></head><body><h1>${esc(title)}</h1>${markdownToHtml(body)}</body></html>`,
    ], { type: f.mime });
  } else if (f.ext === 'json') {
    let content = body;
    try { content = JSON.stringify(JSON.parse(body), null, 2); } catch { content = JSON.stringify({ title, content: body }, null, 2); }
    blob = new Blob([content], { type: f.mime });
  } else if (f.ext === 'md') blob = new Blob([`# ${title}\n\n${body}`], { type: f.mime });
  else blob = new Blob([title ? `${title}\n${'='.repeat(Math.min(60, title.length))}\n\n${body}` : body], { type: f.mime });
  return { blob, name, mime: f.mime, ext: f.ext };
}

// ---------- reading what the user attaches ----------
const TEXT_LIKE = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|csv))/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|json|xml|yaml|yml|html?|js|ts|jsx|tsx|py|java|c|cpp|cs|go|rs|sh|sql|log|ini|cfg|toml)$/i;

let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      const lib = mod.default ?? mod;
      try { lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString(); } catch { /* fallback: main-thread */ }
      return lib;
    });
  }
  return pdfjsPromise;
}

/** Text of a PDF (first `maxPages` pages), or '' when it cannot be read. */
export async function pdfText(file, { maxPages = 30, maxChars = 60000 } = {}) {
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    const parts = [];
    let total = 0;
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = content.items.map((it) => it.str).join(' ').replace(/\s{2,}/g, ' ').trim();
      if (line) { parts.push(line); total += line.length; }
      if (total > maxChars) break;
    }
    return parts.join('\n\n').slice(0, maxChars);
  } catch {
    return '';
  }
}

/** Best-effort text of any attached file (for the assistant's context). */
export async function extractText(file, opts = {}) {
  const name = file.name ?? '';
  const type = file.type ?? '';
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return pdfText(file, opts);
  if (TEXT_LIKE.test(type) || TEXT_EXT.test(name)) {
    try { return (await file.text()).slice(0, opts.maxChars ?? 60000); } catch { return ''; }
  }
  return '';
}

export const isImageFile = (f) => /^image\//.test(f?.type ?? '');
