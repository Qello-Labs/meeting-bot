// 만든 페이지를 다시 읽어 제목, 상위 페이지, 본문 줄을 대조하고 지난 회의 끝 시각을 갱신한다(설계 5절 H, 5절 D).
// 공백, 목록 기호, 표 구분선, 역슬래시 이스케이프(`\~`, `\[` 등) 차이는 같은 것으로 본다. 다르면 다른 줄 수를 알린다.
// 실제 ClickUp은 링크가 아닌 대괄호를 `\[…\]`로 바꿔 저장했다(2026-10-11 실제 확인). 페이지는 이미 만들어졌으므로 지우지 않는다.
// CLICKUP(워크스페이스·문서·상위 페이지 ID)은 scripts/build-workflow.js가 이 코드 앞에 붙인다.
const prepared = $('쓰기 준비').first().json;
const created = $('페이지 만들기').first().json;
const decision = $('결정 읽기').first().json;
const meeting = $('녹음 정보 확인').first().json;
const page = $input.first().json;

const comparable = (markdown) => String(markdown ?? '')
  .split('\n')
  .map((line) => line
    .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1')
    .replace(/^\s*[*+-]\s+/, '- ')
    .replace(/^\s*\|?\s*:?-{3,}.*$/, '|---|')
    .replace(/\s+/g, ' ')
    .trim())
  .filter((line) => line !== '');

// 두 줄 목록에서 같은 순서로 남는 줄(최장 공통 부분열) 밖의 줄 수를 다른 줄 수로 센다.
const expected = comparable(prepared.content);
const actual = comparable(page.content);
const lcs = Array.from({ length: expected.length + 1 }, () => new Array(actual.length + 1).fill(0));
for (let i = expected.length - 1; i >= 0; i -= 1) {
  for (let j = actual.length - 1; j >= 0; j -= 1) {
    lcs[i][j] = expected[i] === actual[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
}
const differentLines = expected.length + actual.length - 2 * lcs[0][0];
const nameOk = page.name === prepared.name;
const parentOk = page.parent_page_id === prepared.parentPageId;
const matched = nameOk && parentOk && differentLines === 0;

// 페이지를 만들었으므로 다음 회의의 결정 메시지는 이번 회의 종료 뒤부터 모은다(대조가 달라도 페이지는 남는다).
$getWorkflowStaticData('global').lastMeetingEndedAt = meeting.endedAt;

const link = `https://app.clickup.com/${CLICKUP.workspaceId}/v/dc/${CLICKUP.docId}/${created.id}`;
const problems = [
  ...(nameOk ? [] : ['제목']),
  ...(parentOk ? [] : ['상위 페이지']),
  ...(differentLines === 0 ? [] : [`본문 ${differentLines}줄`]),
];
const result = matched ? 'ClickUp에 썼습니다' : `ClickUp에 썼지만 다시 읽은 내용이 달라 확인이 필요합니다(${problems.join(', ')})`;
return [{
  json: {
    pageId: created.id,
    link,
    matched,
    nameOk,
    parentOk,
    differentLines,
    textChannelId: decision.textChannelId,
    messageId: decision.messageId,
    body: {
      content: `회의 ${meeting.meetingId} 회의록 초안: 승인(${decision.by}). ${result}: ${link}`,
      components: [],
      allowed_mentions: { parse: [] },
    },
  },
}];
