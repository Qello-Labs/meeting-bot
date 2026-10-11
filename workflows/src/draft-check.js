// GPT가 채운 초안을 코드로 검증한다(설계 5절 F). 근거가 실제 입력에 없으면 draftOk: false로 표시해 승인(8단계)으로 넘기지 않는다.
// 검증 실패는 실행을 실패시키지 않고 회의 채널에 오류 종류별 개수를 알린다. 실패 알림 워크플로(10단계)가 없어 실행이 실패하면 알림이 가지 않는다.
// 응답 잘림, 거절처럼 초안 자체가 없는 경우는 실행을 실패시킨다(2026-10-11 사용자 결정). 초안과 오류 목록은 n8n 실행 기록에만 남긴다.
const meeting = $('녹음 정보 확인').first().json;
const transcript = $('녹취 만들기').first().json.transcript;
const picked = $('결정 메시지 고르기').first().json;
const { template, meetingDate } = $('초안 요청 만들기').first().json;
const response = $input.first().json;

// 출력 한도(생각 토큰 포함)에 닿거나 콘텐츠 필터에 걸리면 status가 incomplete다. 일부만 나온 초안은 쓰지 않는다.
if (response.status === 'incomplete') {
  const reason = response.incomplete_details?.reason ?? '알 수 없음';
  throw new Error(reason === 'max_output_tokens' ? '초안이 max_output_tokens에서 잘렸습니다' : `초안 응답이 중단됐습니다(이유: ${reason})`);
}
if (response.status !== 'completed') throw new Error(`초안 응답이 끝나지 않았습니다(status: ${response.status})`);

// 출력에는 reasoning 항목과 message 항목이 섞여 온다. 진행 설명(phase: commentary) 메시지는 빼고 최종 메시지의 output_text만 읽는다.
const messages = (Array.isArray(response.output) ? response.output : [])
  .filter((item) => item?.type === 'message' && item.phase !== 'commentary');
const parts = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
if (parts.some((part) => part?.type === 'refusal')) throw new Error(`GPT가 초안 작성을 거절했습니다(응답 모델: ${response.model})`);
let draft = parts.filter((part) => part?.type === 'output_text').map((part) => part.text).join('').trim();
const fenced = draft.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
if (fenced) draft = fenced[1].trim();
if (draft === '') throw new Error('GPT 응답에 초안 본문이 없습니다');

// 근거 검증 규칙은 shared/draft-rules.js의 verifyDraft다(수정 검증과 같은 코드).
const verified = verifyDraft(draft, {
  template,
  meetingDate,
  attendees: meeting.attendees,
  transcript,
  decisions: picked.decisions,
});

return [{
  json: {
    ...verified,
    // 어느 모델이 초안을 썼는지와 토큰 수(생각 토큰 포함)를 남긴다. 회의당 비용을 잴 때 쓴다.
    model: response.model,
    usage: response.usage ?? null,
  },
}];
