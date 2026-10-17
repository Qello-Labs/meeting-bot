// 승인된 회의록의 `## 액션 아이템` 표에서 Jira 이슈로 만들 행을 고른다(#32). 행을 고르는 일은 코드가 한다(AGENTS.md 3.2).
// 할 일이 비었거나 "없음"인 행은 건너뛴다. 이슈 칸에 이미 이슈 키가 있는 행(사람이 고쳐 넣은 것)은 새로 만들지 않고 그 키를 쓴다.
// JIRA(사이트·프로젝트·보드·이슈 유형·스프린트 필드)는 scripts/build-workflow.js가 이 코드 앞에 붙인다.
const prepared = $('쓰기 준비').first().json;
const meeting = $('녹음 정보 확인').first().json;

const BLANK = ['', '없음', '-'];
const lines = prepared.content.split('\n');
const start = lines.findIndex((l) => /^## /.test(l) && l.slice(3).trim() === '액션 아이템');
const end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && /^## /.test(l));
const section = start < 0 ? [] : lines.slice(start + 1, end < 0 ? lines.length : end).map((text, k) => ({ text, index: start + 1 + k }));
const tableLines = [];
const tableStart = section.findIndex((l) => /^\s*\|/.test(l.text));
for (const line of tableStart < 0 ? [] : section.slice(tableStart)) {
  if (!/^\s*\|/.test(line.text)) break;
  tableLines.push(line);
}
const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const isSeparator = (l) => /^\s*\|?\s*:?-{3,}/.test(l);
const header = tableLines.length ? cellsOf(tableLines[0].text) : [];
const column = (name) => header.findIndex((h) => h === name);
const columns = { part: column('담당 파트'), owner: column('담당자'), task: column('할 일'), due: column('기한'), issue: header.findIndex((h) => /jira/i.test(h)) };
const KEY = new RegExp(`\\b${JIRA.projectKey}-\\d+\\b`);

const rows = columns.task < 0 ? [] : tableLines.slice(1).filter((l) => !isSeparator(l.text)).map((l) => {
  const cells = cellsOf(l.text);
  const value = (i) => (i < 0 ? '' : (cells[i] ?? '').replace(/\\\|/g, '|').trim());
  return {
    lineIndex: l.index,
    part: value(columns.part),
    owner: value(columns.owner),
    task: value(columns.task),
    due: /^\d{4}-\d{2}-\d{2}$/.test(value(columns.due)) ? value(columns.due) : null,
    existingKey: value(columns.issue).match(KEY)?.[0] ?? null,
  };
}).filter((row) => !BLANK.includes(row.task));

return [{
  json: {
    meetingId: meeting.meetingId,
    label: `meeting-${meeting.meetingId}`,
    // 표 머리글이 템플릿과 달라 이슈 칸이 없으면 이슈는 만들되 회의록에는 채우지 못한다(결과 메시지에 적는다).
    issueColumn: columns.issue,
    rows,
    // 같은 회의 레이블의 이슈를 찾는 JQL. 다시 처리해도 같은 할 일의 이슈를 또 만들지 않는다.
    jql: `project = ${JIRA.projectKey} AND labels = "meeting-${meeting.meetingId}" ORDER BY created ASC`,
  },
}];
