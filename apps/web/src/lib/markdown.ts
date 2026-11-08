/**
 * A small Markdown reader for advisor answers. It returns data (blocks and spans), never HTML: the panel renders it as React
 * elements, so raw HTML in an answer shows as plain text and nothing is injected. Links keep only http(s) and mailto targets.
 */
export type Span =
  | { t: "text"; v: string }
  | { t: "strong" | "em"; c: Span[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Span[] };

export type Block =
  | { t: "p"; c: Span[] }
  | { t: "h"; level: 3 | 4; c: Span[] }
  | { t: "ul" | "ol"; items: Span[][] }
  | { t: "quote"; c: Span[] }
  | { t: "pre"; v: string };

export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

// Sticky patterns, tried at the cursor only; every body is length-bounded so one failed attempt costs O(500), never O(rest of the answer).
const CODE = /`([^`\n]{1,500})`/y;
const STRONG = /\*\*(?=\S)([^\n]{1,500}?)(?<=\S)\*\*/y;
const EM = /(?:\*(?=\S)([^*\n]{1,500}?)(?<=\S)\*|_(?=\S)([^_\n]{1,500}?)(?<=\S)_)/y;
const LINK = /\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/y;
const SPECIAL = /[`*_[]/g;

/** Emphasis, links and code nested deeper than this are shown as plain text. */
export const MAX_NESTING = 3;

function matchAt(re: RegExp, src: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(src);
}

export function inline(src: string, depth = 0): Span[] {
  const out: Span[] = [];
  let i = 0;
  let from = 0; // start of the pending plain text
  const flush = (to: number) => { if (to > from) out.push({ t: "text", v: src.slice(from, to) }); };
  while (i < src.length) {
    SPECIAL.lastIndex = i;
    const next = SPECIAL.exec(src);
    if (!next) break;
    i = next.index;
    let m: RegExpExecArray | null;
    let span: Span | null = null;
    if ((m = matchAt(CODE, src, i))) span = { t: "code", v: m[1] };
    else if (depth < MAX_NESTING && (m = matchAt(STRONG, src, i))) span = { t: "strong", c: inline(m[1], depth + 1) };
    else if (depth < MAX_NESTING && (m = matchAt(EM, src, i))) span = { t: "em", c: inline(m[1] ?? m[2], depth + 1) };
    else if (depth < MAX_NESTING && (m = matchAt(LINK, src, i))) {
      const href = safeHref(m[2]);
      span = href ? { t: "link", href, c: inline(m[1], depth + 1) } : { t: "text", v: m[1] };
    }
    if (!span || !m) { i += 1; continue; }
    flush(i);
    out.push(span);
    i += m[0].length;
    from = i;
  }
  flush(src.length);
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => { if (para.length) blocks.push({ t: "p", c: inline(para.join(" ")) }); para = []; };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (/^\s*```/.test(line)) {
      endPara();
      const code: string[] = [];
      n++;
      while (n < lines.length && !/^\s*```/.test(lines[n])) code.push(lines[n++]);
      blocks.push({ t: "pre", v: code.join("\n") });
      continue;
    }
    if (!line.trim()) { endPara(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { endPara(); blocks.push({ t: "h", level: m[1].length <= 2 ? 3 : 4, c: inline(m[2]) }); continue; }
    if ((m = line.match(/^\s*>\s?(.*)$/))) {
      endPara();
      const q = [m[1]];
      while (n + 1 < lines.length && (m = lines[n + 1].match(/^\s*>\s?(.*)$/))) { q.push(m[1]); n++; }
      blocks.push({ t: "quote", c: inline(q.join(" ")) });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/;
    const number = /^\s*\d+[.)]\s+(.*)$/;
    const re = bullet.test(line) ? bullet : number.test(line) ? number : null;
    if (re) {
      endPara();
      const items: Span[][] = [];
      let cur = line.match(re)![1];
      while (n + 1 < lines.length) {
        const next = lines[n + 1];
        const nm = next.match(re);
        if (nm) { items.push(inline(cur)); cur = nm[1]; n++; }
        else if (next.trim() && /^\s{2,}\S/.test(next) && !bullet.test(next) && !number.test(next)) { cur += ` ${next.trim()}`; n++; }
        else break;
      }
      items.push(inline(cur));
      blocks.push({ t: re === bullet ? "ul" : "ol", items });
      continue;
    }
    para.push(line.trim());
  }
  endPara();
  return blocks;
}
