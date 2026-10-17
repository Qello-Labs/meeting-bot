// 상위 페이지 아래에 같은 이름의 페이지가 있으면 쓰지 않는다(설계 5절 H). 같은 회의를 다시 처리했거나 같은 날 회의가 두 번인 경우다.
// 같은 이름 확인 노드는 페이지 목록(트리)의 맨 위 페이지 하나를 항목 하나로 낸다. 목록이 비면 alwaysOutputData로 빈 항목 하나가 온다.
const prepared = $('쓰기 준비').first().json;
const decision = $('결정 읽기').first().json;
const meeting = $('녹음 정보 확인').first().json;

const pages = $input.all().map((item) => item.json).filter((page) => typeof page?.id === 'string');
const find = (list) => {
  for (const page of list) {
    if (page.id === prepared.parentPageId) return page;
    const found = find(Array.isArray(page.pages) ? page.pages : []);
    if (found) return found;
  }
  return null;
};
const parent = find(pages);
// 상위 페이지가 없으면 ID 설정이 틀린 것이다. 문서 맨 위에 쓰면 수집기가 회의록으로 보지 않으므로 멈춘다.
if (!parent) throw new Error('ClickUp 회의록 문서에서 상위 페이지를 찾지 못했습니다');

const duplicate = (parent.pages ?? []).some((page) => page.name === prepared.name);
return [{
  json: {
    duplicate,
    textChannelId: decision.textChannelId,
    messageId: decision.messageId,
    request: prepared.request,
    // 같은 이름이 있으면 바로 이 내용으로 초안 메시지를 고치고 끝낸다.
    body: duplicate ? {
      content: `회의 ${meeting.meetingId} 회의록 초안: 승인(${decision.by}). ClickUp에 같은 이름(${prepared.name})의 페이지가 있어 쓰지 않았습니다`,
      components: [],
      allowed_mentions: { parse: [] },
    } : null,
  },
}];
