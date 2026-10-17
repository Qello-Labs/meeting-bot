// 승인된 회의록을 ClickUp에 쓸 준비를 한다(설계 5절 H). 승인이 아니면 항목을 내지 않아 ClickUp에 쓰지 않는다.
// CLICKUP(워크스페이스·문서·상위 페이지 ID)은 scripts/build-workflow.js가 이 코드 앞에 붙인다.
const MEETING_KIND = '정기 회의'; // 회의 종류 고정값(shared/draft-rules.js의 고정 필드와 같다)

/**
 * ClickUp Markdown이 다르게 그리는 곳을 고친다. 여러 번 적용해도 결과가 같다.
 * 인용 줄 뒤 빈 줄, 새 번호 목록 앞 빈 줄, `~` 이스케이프, 따옴표 안 굵게를 밖으로, 표 셀 안 굵게 제거.
 */
function normalizeForClickUp(markdown) {
  const out = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    let line = raw.replace(/(?<!\\)~/g, '\\~').replace(/\*\*“([^”\n]*)”\*\*/g, '“**$1**”');
    if (/^\s*\|/.test(line)) line = line.replace(/\*\*(.+?)\*\*/g, '$1');
    const prev = out[out.length - 1];
    // 새 번호 목록(1.)이 앞 줄에 붙어 있으면 앞 목록에 이어 번호가 매겨진다.
    if (/^\s*1\.\s/.test(line) && prev !== undefined && prev.trim() !== '') out.push('');
    out.push(line);
    // 인용 줄 다음에 빈 줄이 없으면 다음 줄이 인용 안으로 들어간다.
    const next = lines[i + 1];
    if (/^\s*>/.test(line) && next !== undefined && next.trim() !== '' && !/^\s*>/.test(next)) out.push('');
  });
  return out.join('\n');
}

const decision = $('결정 읽기').first().json;
if (decision.outcome !== 'approve') return [];
if (!CLICKUP.parentPageId) throw new Error('ClickUp 상위 페이지 ID가 없습니다. scripts/build-workflow.js의 MINUTES_PARENT_PAGE를 확인해 주세요');

const { meetingDate } = $('초안 요청 만들기').first().json;
const name = `${meetingDate} ${MEETING_KIND}`;
const content = normalizeForClickUp(decision.draft);
return [{
  json: {
    name,
    content,
    parentPageId: CLICKUP.parentPageId,
    request: { parent_page_id: CLICKUP.parentPageId, name, content, content_format: 'text/md' },
  },
}];
