// 만든 페이지를 다시 읽어 제목, 상위 페이지, 본문 줄을 대조하고 지난 회의 끝 시각을 갱신한다(설계 5절 H, 5절 D).
// 다시 읽은 저장 형식을 Markdown으로 바꿔 보낸 Markdown과 줄 단위로 비교한다(shared/confluence-format.js의 comparableLines).
// 페이지는 이미 만들어졌으므로 달라도 지우지 않는다.
// 결과 메시지에 Jira 이슈를 만든 결과를 덧붙인다(#32).
// CONFLUENCE(사이트·스페이스·상위 페이지)는 scripts/build-workflow.js가 이 코드 앞에 붙인다.
// 보낸 본문은 Jira 이슈 키를 채운 뒤의 것이다(회의록에 이슈 채우기).
const prepared = $('회의록에 이슈 채우기').first().json;
const created = $('페이지 만들기').first().json;
const decision = $('결정 읽기').first().json;
const meeting = $('녹음 정보 확인').first().json;
const page = $input.first().json;

// 두 줄 목록에서 같은 순서로 남는 줄(최장 공통 부분열) 밖의 줄 수를 다른 줄 수로 센다.
const expected = comparableLines(prepared.content);
const actual = comparableLines(storageToMarkdown(page.body?.storage?.value ?? ''));
const lcs = Array.from({ length: expected.length + 1 }, () => new Array(actual.length + 1).fill(0));
for (let i = expected.length - 1; i >= 0; i -= 1) {
  for (let j = actual.length - 1; j >= 0; j -= 1) {
    lcs[i][j] = expected[i] === actual[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
}
const differentLines = expected.length + actual.length - 2 * lcs[0][0];
const nameOk = page.title === prepared.name;
const parentOk = String(page.parentId ?? '') === prepared.parentPageId;
const matched = nameOk && parentOk && differentLines === 0;

// 페이지를 만들었으므로 다음 회의의 결정 메시지는 이번 회의 종료 뒤부터 모은다(대조가 달라도 페이지는 남는다).
$getWorkflowStaticData('global').lastMeetingEndedAt = meeting.endedAt;

const link = `${CONFLUENCE.site}/wiki/spaces/${CONFLUENCE.spaceKey}/pages/${created.id}`;
const problems = [
  ...(nameOk ? [] : ['제목']),
  ...(parentOk ? [] : ['상위 페이지']),
  ...(differentLines === 0 ? [] : [`본문 ${differentLines}줄`]),
];
const result = matched ? 'Confluence에 썼습니다' : `Confluence에 썼지만 다시 읽은 내용이 달라 확인이 필요합니다(${problems.join(', ')})`;
const { jira } = prepared;
const jiraParts = [
  ...(jira.created.length ? [`이슈 ${jira.created.length}개를 만들었습니다(${jira.created.join(', ')})`] : []),
  ...(jira.reused.length ? [`이미 있던 이슈 ${jira.reused.length}개를 연결했습니다(${jira.reused.join(', ')})`] : []),
  ...(jira.backlog ? [`${jira.backlog}개는 맞는 스프린트가 없어 백로그에 있습니다`] : []),
  ...(!jira.filled && jira.rows ? ['회의록 표에 Jira 이슈 칸이 없어 링크를 채우지 못했습니다'] : []),
];
const jiraResult = jira.rows === 0 ? '액션 아이템이 없어 Jira 이슈는 만들지 않았습니다' : `Jira: ${jiraParts.join(', ')}`;
return [{
  json: {
    pageId: created.id,
    jira,
    link,
    matched,
    nameOk,
    parentOk,
    differentLines,
    textChannelId: decision.textChannelId,
    messageId: decision.messageId,
    body: {
      content: `회의 ${meeting.meetingId} 회의록 초안: 승인(${decision.by}). ${result}: ${link}\n${jiraResult}`,
      components: [],
      allowed_mentions: { parse: [] },
    },
  },
}];
