#!/usr/bin/env node
/*
 * build.js — zero-dependency static site builder.
 *
 * Reads posts/*.md and about.md, converts them to HTML with a tiny markdown
 * converter (the only place to extend if you want richer formatting), writes a
 * posts.json manifest, and copies src/* into dist/. The GitHub Action runs this
 * on every push, then deploys dist/ to GitHub Pages.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, 'posts');
const SRC_DIR = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

// ---------------------------------------------------------------------------
// Tiny markdown converter — supports the subset we actually use:
//   #/##/### headings, paragraphs (blank line = new paragraph),
//   single newline = <br>, ![alt](src) images, [text](url) links,
//   **bold**, *italic*. Everything else is HTML-escaped.
// To support more markdown later, extend the functions below.
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => `<img src="${src}" alt="${alt}">`);
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      out.push('<p>' + para.map(inline).join('<br>') + '</p>');
      para = [];
    }
  };
  for (const line of lines) {
    if (line.trim() === '') { flush(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    para.push(line);
  }
  flush();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Post metadata helpers
// ---------------------------------------------------------------------------
const slugFromFilename = (fn) => fn.replace(/\.md$/, '');
const dateFromFilename = (fn) => {
  const m = fn.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
};
const titleFromMd = (md) => {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '(untitled)';
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'posts'), { recursive: true });

const manifest = [];
if (fs.existsSync(POSTS_DIR)) {
  for (const fn of fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'))) {
    const md = fs.readFileSync(path.join(POSTS_DIR, fn), 'utf8');
    const slug = slugFromFilename(fn);
    fs.writeFileSync(path.join(DIST, 'posts', slug + '.html'), mdToHtml(md));
    manifest.push({ slug, title: titleFromMd(md), date: dateFromFilename(fn) });
  }
}
// Newest first (by date prefix, then slug as tiebreaker).
manifest.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.slug.localeCompare(a.slug));
fs.writeFileSync(path.join(DIST, 'posts.json'), JSON.stringify(manifest, null, 2));

// About page
const aboutPath = path.join(ROOT, 'about.md');
if (fs.existsSync(aboutPath)) {
  fs.writeFileSync(path.join(DIST, 'about.html'), mdToHtml(fs.readFileSync(aboutPath, 'utf8')));
}

// Copy the static site source (flat directory) into dist/
for (const fn of fs.readdirSync(SRC_DIR)) {
  fs.copyFileSync(path.join(SRC_DIR, fn), path.join(DIST, fn));
}

// Copy images/ (if present) into dist/images so posts can reference images/<file>.
const IMAGES_DIR = path.join(ROOT, 'images');
if (fs.existsSync(IMAGES_DIR)) {
  fs.cpSync(IMAGES_DIR, path.join(DIST, 'images'), { recursive: true });
}
// Disable Jekyll so GitHub Pages serves our files verbatim.
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

console.log(`Built ${manifest.length} post(s) → dist/`);
