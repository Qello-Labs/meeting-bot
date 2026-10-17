// 회의 녹취 워크플로가 실패하면 회의 채널에 보낼 알림과 초안 메시지 고치기 요청을 만든다(설계 5절 "실패 알림").
// 실패(Error Trigger)가 주는 오류에는 요청 본문(녹취·초안), 쿼리를 포함한 주소, 사람이 쓴 글이 섞일 수 있다(n8n 2.42.6 실험).
// 그래서 알림에는 코드가 정한 값만 넣는다: 노드 이름(워크플로에 있는 이름만), 오류 종류, 회의 ID, 실행 ID.
// 앞에 붙는 상수: FALLBACK_CHANNEL_ID(실제 회의 채널), NODE_TYPES(회의 녹취 워크플로의 노드 이름과 종류), AFTER_WRITE(페이지 만들기와 그 뒤 노드).
const { execution } = $('실패').first().json;
// 실행 읽기(n8n API)가 실패하면 오류 항목이 온다. 그때는 customData가 없으므로 고정 채널로 보낸다.
const customData = $input.first().json?.customData ?? {};

const pick = (value, pattern) => (typeof value === 'string' && pattern.test(value) ? value : null);
const meetingId = pick(customData.meetingId, /^\d{8}-\d{4}$/);
const meetingChannelId = pick(customData.textChannelId, /^\d{17,20}$/);
const channelId = meetingChannelId ?? FALLBACK_CHANNEL_ID;
const draftMessageId = pick(customData.draftMessageId, /^\d{17,20}$/);
const executionId = pick(String(execution?.id ?? ''), /^\d+$/) ?? '알 수 없음';

const error = execution?.error ?? {};
// Code 노드가 던진 오류에는 error.node가 없다(n8n 2.42.6 실험). 노드 종류는 이름으로 NODE_TYPES에서 찾는다.
const failedNode = [error.node?.name, execution?.lastNodeExecuted].find((name) => Object.hasOwn(NODE_TYPES, name)) ?? null;

// 오류 종류. 상태 코드와 시스템 오류 코드는 형식이 맞을 때만 쓴다.
const httpCode = String(error.httpCode ?? '');
let kind = '기타 오류';
if (/^\d{3}$/.test(httpCode)) kind = `외부 서비스 응답 오류(HTTP ${httpCode})`;
else if (/^E[A-Z_]{2,30}$/.test(httpCode)) kind = `연결 실패(${httpCode})`;
else if (NODE_TYPES[failedNode] === 'n8n-nodes-base.code') kind = '검사 중단';

const where = failedNode ? `'${failedNode}' 단계에서` : '알 수 없는 단계에서';
const writeCheck = AFTER_WRITE.includes(failedNode) ? ' Confluence `회의록`에 페이지가 생겼는지 확인해 주세요.' : '';
const meeting = meetingId ? `회의 ${meetingId} ` : '';

return [{
  json: {
    channelId,
    draftMessageId,
    notice: {
      content: `${meeting}회의록 처리가 ${where} 실패했습니다. 오류: ${kind}. n8n 실행 ${executionId}에서 확인해 주세요.${writeCheck}`,
      allowed_mentions: { parse: [] },
    },
    // 끝난 실행의 버튼은 n8n이 409로 거절하므로 지운다. 초안 메시지는 회의 채널에 있으므로 회의 채널을 알 때만 고친다.
    draftEdit: draftMessageId && meetingId && meetingChannelId
      ? {
        content: `회의 ${meetingId} 회의록 초안: 처리 중 실패했습니다(n8n 실행 ${executionId}).${writeCheck}`,
        components: [],
        allowed_mentions: { parse: [] },
      }
      : null,
  },
}];
