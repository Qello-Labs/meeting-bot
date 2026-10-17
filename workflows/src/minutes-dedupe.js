// 스페이스에 같은 제목의 페이지가 있으면 쓰지 않는다(설계 5절 H). 같은 회의를 다시 처리했거나 같은 날 회의가 두 번인 경우다.
// Confluence는 한 스페이스 안에서 페이지 제목이 겹칠 수 없어서 `회의록` 아래만이 아니라 스페이스 전체에서 찾는다.
// 같은 제목 찾기 노드는 GET /pages?space-id&title 응답 하나를 낸다. 응답 형식이 다르면 판단할 수 없으므로 멈춘다.
const prepared = $('쓰기 준비').first().json;
const decision = $('결정 읽기').first().json;
const meeting = $('녹음 정보 확인').first().json;

const found = $input.first().json?.results;
if (!Array.isArray(found)) throw new Error('Confluence 페이지 검색 응답에 results가 없습니다');

const duplicate = found.some((page) => page?.title === prepared.name);
return [{
  json: {
    duplicate,
    textChannelId: decision.textChannelId,
    messageId: decision.messageId,
    request: prepared.request,
    // 같은 제목이 있으면 바로 이 내용으로 초안 메시지를 고치고 끝낸다.
    body: duplicate ? {
      content: `회의 ${meeting.meetingId} 회의록 초안: 승인(${decision.by}). Confluence에 같은 제목(${prepared.name})의 페이지가 있어 쓰지 않았습니다`,
      components: [],
      allowed_mentions: { parse: [] },
    } : null,
  },
}];
