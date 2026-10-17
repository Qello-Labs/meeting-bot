// 만든 이슈와 이미 있던 이슈의 키를 회의록 액션 아이템 표의 Jira 이슈 칸에 채우고, Confluence에 쓸 요청을 다시 만든다(#32).
// 새 이슈 확인(If)의 두 갈래(이슈를 만들었을 때, 만들 것이 없을 때)가 모두 이 노드로 온다.
// JIRA는 scripts/build-workflow.js가, markdownToStorage는 shared/confluence-format.js가 이 코드 앞에 붙인다.
const prepared = $('쓰기 준비').first().json;
const picked = $('액션 아이템 고르기').first().json;
const requested = $('이슈 요청 만들기').all().map((item) => item.json);
const { plans } = requested[0];
const created = $('Jira 이슈 만들기').isExecuted ? $('Jira 이슈 만들기').all().map((item) => item.json) : [];

// 만들기 응답은 요청 순서대로 온다. 수가 다르거나 키 형식이 다르면 어느 행의 이슈인지 알 수 없으므로 멈춘다.
const toCreate = requested.filter((r) => r.create);
const KEY = new RegExp(`^${JIRA.projectKey}-\\d+$`);
if (created.length !== toCreate.length || created.some((c) => !KEY.test(String(c?.key ?? '')))) {
  throw new Error(`Jira 이슈 만들기 응답이 요청과 맞지 않습니다(요청 ${toCreate.length}개, 응답 ${created.length}개)`);
}
const createdByRow = new Map(toCreate.map((r, i) => [r.row, created[i].key]));
const keys = plans.map((p) => p.key ?? createdByRow.get(p.row) ?? null);

const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const lines = prepared.content.split('\n');
if (picked.issueColumn >= 0) {
  picked.rows.forEach((row, i) => {
    if (!keys[i]) return;
    const cells = cellsOf(lines[row.lineIndex]);
    while (cells.length <= picked.issueColumn) cells.push('');
    cells[picked.issueColumn] = `[${keys[i]}](${JIRA.site}/browse/${keys[i]})`;
    lines[row.lineIndex] = `| ${cells.join(' | ')} |`;
  });
}
const content = lines.join('\n');

return [{
  json: {
    name: prepared.name,
    content,
    parentPageId: prepared.parentPageId,
    request: { ...prepared.request, body: { representation: 'storage', value: markdownToStorage(content) } },
    jira: {
      rows: picked.rows.length,
      created: plans.filter((p) => !p.key).map((p) => createdByRow.get(p.row)),
      reused: plans.filter((p) => p.key).map((p) => p.key),
      backlog: plans.filter((p) => !p.key && !p.sprint).length,
      filled: picked.issueColumn >= 0,
    },
  },
}];
