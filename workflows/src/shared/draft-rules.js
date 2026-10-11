// 회의록 초안 근거 검증 규칙(설계 5절 F). 초안 검증(GPT 초안)과 수정 검증(사람이 고친 초안)이 같은 규칙을 쓰도록
// scripts/build-workflow.js가 이 파일을 두 Code 노드 앞에 붙인다. n8n Code 노드는 다른 파일을 가져올 수 없다.
/**
 * 템플릿 구조, 고정 필드, 날짜·명세 ID, 근거, 자리표시자를 확인한다. 고정 필드는 덮어쓰고 날짜·명세 ID는 정리한 초안을 돌려준다.
 * @returns {{ draftOk: boolean, draft: string, errorCounts: object, errors: object[], cleaned: object }}
 */
function verifyDraft(draft, { template, meetingDate, attendees, transcript, decisions }) {
  const errors = [];
  const fail = (kind, detail) => errors.push({ kind, detail });
  const cleaned = { dates: [], specIds: [] };

  // --- Markdown 읽기 ---------------------------------------------------------
  const headingsOf = (lines) => lines.filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim());
  /** `## name` 아래부터 다음 `##` 앞까지의 줄 번호 */
  const sectionOf = (lines, name) => {
    const start = lines.findIndex((l) => /^## /.test(l) && l.slice(3).trim() === name);
    if (start < 0) return [];
    const rest = lines.slice(start + 1).findIndex((l) => /^## /.test(l));
    const end = rest < 0 ? lines.length : start + 1 + rest;
    return Array.from({ length: end - start - 1 }, (_, i) => start + 1 + i);
  };
  const isRow = (l) => /^\s*\|/.test(l);
  const isSeparator = (l) => /^\s*\|?\s*:?-{3,}/.test(l);
  const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
  const rowOf = (cells) => `| ${cells.join(' | ')} |`;
  /** 줄 번호 목록 안의 첫 표: 머리글 줄 번호와 데이터 행 줄 번호 */
  const tableIn = (lines, indexes) => {
    const first = indexes.find((i) => isRow(lines[i]));
    if (first === undefined) return null;
    const rows = [];
    for (let i = first; i < lines.length && isRow(lines[i]); i += 1) rows.push(i);
    return { header: rows[0], body: rows.slice(1).filter((i) => !isSeparator(lines[i])) };
  };
  const allIndexes = (lines) => lines.map((_, i) => i);

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const isDate = (value) => DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const isBlank = (value) => ['', '없음', '-'].includes(value.trim());

  // --- 구조: 실행 때 읽은 템플릿이 기준이다 ----------------------------------
  const tLines = template.split('\n');
  const lines = draft.split('\n');

  const tHeadings = headingsOf(tLines);
  const dHeadings = headingsOf(lines);
  if (JSON.stringify(tHeadings) !== JSON.stringify(dHeadings)) {
    fail('구조', `## 제목이 템플릿과 다릅니다. 템플릿: ${tHeadings.join(', ')} / 초안: ${dHeadings.join(', ')}`);
  }

  const tFields = tableIn(tLines, allIndexes(tLines));
  const dFields = tableIn(lines, allIndexes(lines));
  const fieldNames = (t, ls) => (t ? t.body.map((i) => cellsOf(ls[i])[0]) : []);
  if (tFields && JSON.stringify(fieldNames(tFields, tLines)) !== JSON.stringify(fieldNames(dFields, lines))) {
    fail('구조', `필드 표 첫 열이 템플릿과 다릅니다. 템플릿: ${fieldNames(tFields, tLines).join(', ')} / 초안: ${fieldNames(dFields, lines).join(', ')}`);
  }

  const tActions = tableIn(tLines, sectionOf(tLines, '액션 아이템'));
  const dActions = tableIn(lines, sectionOf(lines, '액션 아이템'));
  const headerOf = (t, ls) => (t ? cellsOf(ls[t.header]) : []);
  if (tActions && JSON.stringify(headerOf(tActions, tLines)) !== JSON.stringify(headerOf(dActions, lines))) {
    fail('구조', `액션 아이템 표 머리글이 템플릿과 다릅니다. 템플릿: ${headerOf(tActions, tLines).join(', ')} / 초안: ${headerOf(dActions, lines).join(', ')}`);
  }

  // --- 고정 필드는 코드가 덮어쓴다. 명세 ID는 입력에 그대로 나온 것만 남긴다 -------
  const inputText = [transcript, ...decisions.map((d) => d.content)].join('\n');
  const cellText = (value) => String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|');
  const FIXED = { 일시: meetingDate, '회의 종류': '정기 회의', 참석자: attendees.map(cellText).join(', ') };
  for (const i of dFields?.body ?? []) {
    const cells = cellsOf(lines[i]);
    if (cells.length < 2) continue;
    if (Object.hasOwn(FIXED, cells[0])) cells[1] = FIXED[cells[0]];
    if (cells[0] === '관련 명세 ID' && !isBlank(cells[1])) {
      const ids = cells[1].split(',').map((id) => id.trim()).filter(Boolean);
      const kept = ids.filter((id) => inputText.includes(id));
      cleaned.specIds.push(...ids.filter((id) => !kept.includes(id)));
      cells[1] = kept.length > 0 ? kept.join(', ') : '없음';
    }
    lines[i] = rowOf(cells);
  }

  // --- 날짜: YYYY-MM-DD가 아니면 지운다 -------------------------------------
  const dueColumn = headerOf(dActions, lines).indexOf('기한');
  for (const i of dueColumn < 0 ? [] : dActions.body) {
    const cells = cellsOf(lines[i]);
    const value = cells[dueColumn] ?? '';
    if (!isBlank(value) && !isDate(value)) {
      cleaned.dates.push(`액션 아이템 기한: ${value}`);
      cells[dueColumn] = '';
      lines[i] = rowOf(cells);
    }
  }
  for (const i of sectionOf(lines, '다음 회의')) {
    const m = lines[i].match(/^(\s*[*-]\s+일시:)\s*(.*)$/);
    if (m && !isBlank(m[2]) && !isDate(m[2].trim())) {
      cleaned.dates.push(`다음 회의 일시: ${m[2].trim()}`);
      lines[i] = m[1];
    }
  }

  // --- 근거: 결정마다 녹취 시각이나 수집한 결정 메시지 링크가 있어야 한다 ---------
  // 녹음 끊김 줄의 시각은 근거가 될 수 없다(2026-10-11 사용자 결정). 발화 줄의 [HH:MM:SS]와 정확히 같아야 한다.
  const spokenAt = new Set();
  for (const line of transcript.split('\n')) {
    const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\] (.*)$/);
    if (m && !m[2].startsWith('(녹음 끊김')) spokenAt.add(m[1]);
  }
  const links = new Set(decisions.map((d) => d.link));
  const used = new Set();

  const ITEM = /^[*-]\s+(.*)$/;
  const DECISION = /^(.+?)\. 이유: (.+?)\. \(근거: (.+)\)$/;
  const EVIDENCE = /^(?:녹취 (\d{2}:\d{2}:\d{2})|\[Discord 메시지\]\((https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+)\))$/;
  const items = sectionOf(lines, '결정 사항').map((i) => lines[i].trim()).filter((l) => l !== '');
  const noDecision = items.length === 1 && items[0].match(ITEM)?.[1].trim() === '없음';
  if (noDecision) {
    // 수집한 ✅ 메시지가 없을 때만 근거 없는 "없음"을 허용한다(2026-10-11 사용자 결정).
    if (links.size > 0) fail('근거 형식', '결정 메시지가 있는데 결정 사항이 "없음"입니다');
  } else if (items.length === 0) {
    fail('근거 형식', '결정 사항이 비어 있습니다');
  } else {
    for (const item of items) {
      const body = item.match(ITEM)?.[1].trim();
      const decision = body?.match(DECISION);
      if (!decision) {
        fail('근거 형식', `"<결정>. 이유: <이유>. (근거: …)" 형식이 아닙니다: ${item}`);
        continue;
      }
      for (const evidence of decision[3].split(', ')) {
        const m = evidence.match(EVIDENCE);
        if (!m) fail('근거 형식', `근거 형식이 다릅니다: ${evidence}`);
        else if (m[1] && !spokenAt.has(m[1])) fail('녹취에 없는 시각', m[1]);
        else if (m[2] && !links.has(m[2])) fail('수집하지 않은 링크', m[2]);
        else if (m[2]) used.add(m[2]);
      }
    }
  }
  for (const link of links) if (!used.has(link)) fail('근거로 쓰이지 않은 결정 메시지', link);

  // --- 자리표시자: 고정 필드를 덮어쓴 뒤에도 <…>가 남으면 오류다 ------------------
  const HTML_TAG = /^\/?(?:br|b|i|u|s|p|em|strong|code|pre|sub|sup|span|div|mark)\b[^<>]*\/?$/i;
  const final = lines.join('\n');
  for (const [, inner] of final.matchAll(/<([^<>\n]+)>/g)) {
    if (!/^https?:\/\//.test(inner) && !HTML_TAG.test(inner)) fail('자리표시자', `<${inner}>`);
  }

  const errorCounts = {};
  for (const { kind } of errors) errorCounts[kind] = (errorCounts[kind] ?? 0) + 1;

  return { draftOk: errors.length === 0, draft: final, errorCounts, errors, cleaned };
}
