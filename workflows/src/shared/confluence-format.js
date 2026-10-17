// Confluence 저장 형식(XHTML)과 회의록 Markdown을 서로 바꾼다(결정 기록 2026-10-17-gh31-confluence-minutes).
// Confluence REST API에는 Markdown으로 읽고 쓰는 방법이 없어서, 템플릿 읽기·쓰기 준비·내용 대조 Code 노드가 이 코드를 같이 쓴다.
// 회의록에 나오는 것만 다룬다: 제목, 문단, 목록, 표, 인용, 구분선, 코드 블록, 굵게, 인라인 코드, 링크, 줄바꿈.
// Confluence 매크로(앵커, 마이그레이션 표시 등)는 본문이 있으면 본문만 남기고 없으면 지운다. n8n Code 노드라 URL 같은 전역을 쓰지 않는다.

/** 회의록 Markdown을 Confluence 저장 형식으로 바꾼다. */
function markdownToStorage(markdown) {
  const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const INLINE = /\\([\\`*_{}[\]()#+\-.!~|>])|`([^`\n]+)`|\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|<br\s*\/?>|\*\*(.+?)\*\*/gy;
  const inline = (text) => {
    let out = '';
    let i = 0;
    while (i < text.length) {
      INLINE.lastIndex = i;
      const m = INLINE.exec(text);
      if (!m) {
        out += escapeXml(text[i]);
        i += 1;
        continue;
      }
      // 링크 글자와 굵게 안쪽을 다시 읽으면 같은 정규식의 lastIndex가 바뀌므로 끝 위치를 먼저 잡는다.
      const end = m.index + m[0].length;
      if (m[1] !== undefined) out += escapeXml(m[1]);
      else if (m[2] !== undefined) out += `<code>${escapeXml(m[2])}</code>`;
      else if (m[4] !== undefined) out += `<a href="${escapeXml(m[4])}">${inline(m[3])}</a>`;
      else if (m[5] !== undefined) out += `<a href="${escapeXml(m[5])}">${escapeXml(m[5])}</a>`;
      else if (m[6] !== undefined) out += `<strong>${inline(m[6])}</strong>`;
      else out += '<br />';
      i = end;
    }
    return out;
  };
  const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
  const isSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
  const LIST = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/;
  const indentOf = (s) => s.replace(/\t/g, '    ').length;

  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  const lists = []; // 열린 목록: { indent, tag }
  const flushParagraph = () => {
    // 줄 끝의 <br>은 줄을 잇는 <br />과 겹치므로 뺀다.
    if (paragraph.length) out.push(`<p>${paragraph.map((l) => inline(l.replace(/<br\s*\/?>$/i, ''))).join('<br />')}</p>`);
    paragraph = [];
  };
  const closeLists = (keep = 0) => {
    while (lists.length > keep) out.push(`</li></${lists.pop().tag}>`);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const list = line.match(LIST);
    if (line.trim() === '') {
      flushParagraph();
      // 빈 줄 뒤에 목록 항목이 이어지면 같은 목록으로 본다(GFM). 아니면 목록을 닫는다.
      const next = lines.slice(i + 1).find((l) => l.trim() !== '');
      if (!(next && LIST.test(next))) closeLists();
      continue;
    }
    if (list) {
      flushParagraph();
      const indent = indentOf(list[1]);
      const tag = /\d/.test(list[2]) ? 'ol' : 'ul';
      while (lists.length > 1 && indent < lists[lists.length - 1].indent) closeLists(lists.length - 1);
      const top = lists[lists.length - 1];
      if (top && indent <= top.indent && top.tag !== tag) closeLists(lists.length - 1);
      const current = lists[lists.length - 1];
      if (!current || indent > current.indent) {
        lists.push({ indent, tag });
        out.push(`<${tag}><li><p>${inline(list[3])}</p>`);
      } else {
        out.push(`</li><li><p>${inline(list[3])}</p>`);
      }
      continue;
    }
    if (lists.length && /^\s/.test(line)) {
      // 목록 항목 아래로 들여 쓴 줄은 그 항목의 문단이다.
      out.push(`<p>${inline(line.trim())}</p>`);
      continue;
    }
    closeLists();
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      flushParagraph();
      const body = [];
      for (i += 1; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i += 1) body.push(lines[i]);
      out.push(`<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${body.join('\n').replace(/]]>/g, ']]]]><![CDATA[>')}]]></ac:plain-text-body></ac:structured-macro>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      out.push(`<h${heading[1].length}>${inline(heading[2].trim())}</h${heading[1].length}>`);
      continue;
    }
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      flushParagraph();
      out.push('<hr />');
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushParagraph();
      // 이어진 | 줄을 표 하나로 본다. 구분선은 건너뛰고 첫 행을 머리글로 쓴다.
      const rows = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i += 1) if (!isSeparator(lines[i])) rows.push(cellsOf(lines[i]));
      i -= 1;
      const row = (cells, tag) => `<tr>${cells.map((c) => `<${tag}><p>${inline(c)}</p></${tag}>`).join('')}</tr>`;
      out.push(`<table><tbody>${rows.map((cells, r) => row(cells, r === 0 ? 'th' : 'td')).join('')}</tbody></table>`);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      const quoted = [quote[1]];
      for (; i + 1 < lines.length && /^\s*>/.test(lines[i + 1]); i += 1) quoted.push(lines[i + 1].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote><p>${quoted.map(inline).join('<br />')}</p></blockquote>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeLists();
  return out.join('');
}

/** Confluence 저장 형식을 회의록 Markdown으로 바꾼다. 템플릿 읽기와 다시 읽은 페이지 대조에 쓴다. */
function storageToMarkdown(storage) {
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
  const attrsOf = (text) => {
    const attrs = {};
    for (const m of text.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[m[1]] = decode(m[2] ?? m[3] ?? m[4] ?? '');
    return attrs;
  };

  // --- 읽기: 태그를 나무로 만든다. 닫는 태그가 어긋나면 맞는 곳까지 닫는다 ---------------
  const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr']);
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
  for (const m of String(storage ?? '').matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push({ text: m[1], raw: true });
    else if (m[3] !== undefined) {
      const tag = m[3].toLowerCase();
      if (m[2] === '/') {
        const at = stack.map((n) => n.tag).lastIndexOf(tag);
        if (at > 0) stack.length = at;
      } else {
        const node = { tag, attrs: attrsOf(m[4] ?? ''), children: [] };
        top.children.push(node);
        if (m[5] !== '/' && !VOID.has(tag) && !tag.startsWith('ri:')) stack.push(node);
      }
    } else if (m[6] !== undefined) top.children.push({ text: decode(m[6]) });
    else if (m[0] === '<') top.children.push({ text: '<' });
  }

  // --- 쓰기 ---------------------------------------------------------------------
  const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'hr', 'pre', 'div', 'section',
    'ac:structured-macro', 'ac:layout', 'ac:layout-section', 'ac:layout-cell', 'ac:rich-text-body', 'ac:task-list', 'ac:adf-extension']);
  const childOf = (node, tag) => node.children.find((c) => c.tag === tag);
  const textOf = (node) => (node.text !== undefined ? node.text : node.children.map(textOf).join(''));

  /** 문단 안 내용. 줄바꿈(br)은 \n으로 둔다. */
  const inline = (nodes) => nodes.map((node) => {
    if (node.text !== undefined) return node.raw ? node.text : node.text.replace(/\s+/g, ' ');
    const inner = () => inline(node.children);
    switch (node.tag) {
      case 'br': return '\n';
      case 'strong': case 'b': {
        const text = inner();
        return text.trim() === '' ? text : `**${text.trim()}**`;
      }
      case 'code': return `\`${textOf(node)}\``;
      case 'a': {
        const href = node.attrs.href ?? '';
        const text = inner().trim();
        if (!/^https?:\/\//.test(href)) return text;
        return text === '' || text === href ? `<${href}>` : `[${text}](${href})`;
      }
      case 'ac:link': {
        const body = childOf(node, 'ac:link-body') ?? childOf(node, 'ac:plain-text-link-body');
        if (body) return inline(body.children);
        const target = node.children.find((c) => c.tag?.startsWith('ri:'));
        return target?.attrs['ri:content-title'] ?? target?.attrs['ri:filename'] ?? '';
      }
      case 'ac:placeholder': return `<${textOf(node).trim()}>`;
      case 'time': return node.attrs.datetime ?? '';
      case 'ac:structured-macro': case 'ac:emoticon': case 'ac:image': case 'ac:parameter': case 'ac:adf-extension': case 'img':
        return '';
      default: return BLOCK.has(node.tag) ? `\n${inner()}\n` : inner();
    }
  }).join('');
  const linesOf = (text) => text.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter((l) => l !== '');

  /** 목록 하나를 줄 배열로. 하위 목록은 4칸 들여 쓴다. */
  const listLines = (node, depth) => {
    const lines = [];
    let n = Number.parseInt(node.attrs.start ?? '1', 10) || 1;
    for (const li of node.children.filter((c) => c.tag === 'li' || c.tag === 'ac:task')) {
      const own = li.children.filter((c) => !['ul', 'ol', 'ac:task-list'].includes(c.tag));
      const body = li.tag === 'ac:task' ? (childOf(li, 'ac:task-body')?.children ?? []) : own;
      const marker = li.tag === 'ac:task'
        ? `- [${textOf(childOf(li, 'ac:task-status') ?? { text: '' }).trim() === 'complete' ? 'x' : ' '}] `
        : node.tag === 'ol' ? `${n}. ` : '- ';
      n += 1;
      lines.push(`${'    '.repeat(depth)}${marker}${linesOf(inline(body)).join(' ')}`);
      for (const sub of li.children.filter((c) => ['ul', 'ol', 'ac:task-list'].includes(c.tag))) lines.push(...listLines(sub, depth + 1));
    }
    return lines;
  };

  const tableLines = (node) => {
    const rows = [];
    const collect = (n) => {
      for (const c of n.children) {
        if (c.tag === 'tr') rows.push(c.children.filter((cell) => cell.tag === 'td' || cell.tag === 'th'));
        else if (['thead', 'tbody', 'tfoot'].includes(c.tag)) collect(c);
      }
    };
    collect(node);
    if (rows.length === 0) return [];
    const cell = (c) => linesOf(inline(c.children)).join('<br>').replace(/(?<!\\)\|/g, '\\|');
    const width = Math.max(...rows.map((r) => r.length));
    const line = (cells) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
    const [header, ...body] = rows.map((r) => r.map(cell));
    return [line(header), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...body.map(line)];
  };

  /** 블록 단위로 나눈다. 블록 사이는 빈 줄 하나다. */
  const blocks = (nodes) => {
    const out = [];
    let loose = [];
    const flush = () => {
      const lines = linesOf(inline(loose));
      if (lines.length) out.push(lines.join('\n'));
      loose = [];
    };
    for (const node of nodes) {
      if (node.text !== undefined || !BLOCK.has(node.tag)) {
        loose.push(node);
        continue;
      }
      flush();
      const heading = node.tag.match(/^h([1-6])$/);
      if (heading) {
        const text = linesOf(inline(node.children)).join(' ');
        if (text) out.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
      } else if (node.tag === 'p') {
        const lines = linesOf(inline(node.children));
        if (lines.length) out.push(lines.join('\n'));
      } else if (node.tag === 'ul' || node.tag === 'ol' || node.tag === 'ac:task-list') {
        const lines = listLines(node, 0);
        if (lines.length) out.push(lines.join('\n'));
      } else if (node.tag === 'table') {
        const lines = tableLines(node);
        if (lines.length) out.push(lines.join('\n'));
      } else if (node.tag === 'blockquote') {
        const inner = blocks(node.children).join('\n').split('\n').filter((l) => l !== '');
        if (inner.length) out.push(inner.map((l) => `> ${l}`).join('\n'));
      } else if (node.tag === 'hr') {
        out.push('---');
      } else if (node.tag === 'pre') {
        out.push(`\`\`\`\n${textOf(node).replace(/\n$/, '')}\n\`\`\``);
      } else if (node.tag === 'ac:structured-macro') {
        const name = node.attrs['ac:name'];
        const plain = childOf(node, 'ac:plain-text-body');
        const rich = childOf(node, 'ac:rich-text-body');
        if (name === 'code' && plain) out.push(`\`\`\`\n${textOf(plain).replace(/\n$/, '')}\n\`\`\``);
        else if (rich) out.push(...blocks(rich.children));
      } else if (node.tag === 'ac:adf-extension') {
        // 편집기 전용 확장. 대체 내용(ac:adf-fallback)이 있으면 그것만 읽는다.
        const fallback = childOf(node, 'ac:adf-fallback');
        if (fallback) out.push(...blocks(fallback.children));
      } else {
        out.push(...blocks(node.children));
      }
    }
    flush();
    return out;
  };

  return blocks(root.children).join('\n\n');
}

/**
 * 보낸 Markdown과 다시 읽은 Markdown을 줄 단위로 비교할 수 있게 고친다.
 * 공백, 목록 기호, 번호 목록의 번호, 표 구분선, 역슬래시 이스케이프, <br> 차이는 같은 것으로 본다. 빈 줄은 뺀다.
 */
function comparableLines(markdown) {
  return String(markdown ?? '')
    .split('\n')
    .map((line) => line
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1')
      .replace(/^\s*[*+-]\s+/, '- ')
      .replace(/^\s*\d+[.)]\s+/, '1. ')
      .replace(/^\s*\|?\s*:?-{3,}.*$/, '|---|')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((line) => line !== '');
}
