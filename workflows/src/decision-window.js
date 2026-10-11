// 결정 메시지를 모을 기간을 정한다(설계 5절 D). 시작은 지난 회의록을 ClickUp에 올린 회의의 끝 시각(워크플로 static data, 9단계에서 갱신)이고,
// 없으면 이번 회의 시작 7일 전이다. 끝은 이번 회의 종료 시각이다. 기간은 "시작 초과 ~ 종료 이하"다.
// Discord 메시지 ID에는 작성 시각이 들어 있어서((ms - 2015-01-01) << 22) 기간을 메시지 ID로 바꿔 조회와 거르기에 쓴다.
const DISCORD_EPOCH = 1420070400000n;
const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
// 결정 메시지 조회 노드가 이 횟수까지만 요청한다. 100개씩이라 5,000개까지 받는다(2026-10-11 사용자 결정).
const MAX_REQUESTS = 50;

const meeting = $('녹음 정보 확인').first().json;
const startedMs = Date.parse(meeting.startedAt);
const endedMs = Date.parse(meeting.endedAt);

// 저장된 시각이 이번 회의 종료보다 앞일 때만 쓴다. 없거나 시각이 아니면 처음 실행처럼 7일 전부터 본다.
const stored = $getWorkflowStaticData('global').lastMeetingEndedAt;
const storedMs = typeof stored === 'string' ? Date.parse(stored) : NaN;
const useStored = Number.isFinite(storedMs) && storedMs < endedMs;
const fromMs = useStored ? storedMs : startedMs - FIRST_RUN_LOOKBACK_MS;

// ms 밀리초에 쓰인 메시지의 ID는 idAt(ms)부터 idAt(ms + 1) - 1까지다.
const idAt = (ms) => (BigInt(ms) - DISCORD_EPOCH) << 22n;

return [{
  json: {
    guildId: meeting.guildId,
    channelId: meeting.textChannelId,
    from: new Date(fromMs).toISOString(),
    to: new Date(endedMs).toISOString(),
    source: useStored ? '지난 회의 끝 시각' : '처음 실행(회의 시작 7일 전부터)',
    // 이 ID보다 큰 메시지가 기간 시작 뒤에 쓰였다(after는 이 값을 빼고 그 뒤부터 준다).
    afterId: (idAt(fromMs + 1) - 1n).toString(),
    // 이 ID까지가 회의 종료 시각 안이다.
    endId: (idAt(endedMs + 1) - 1n).toString(),
    maxRequests: MAX_REQUESTS,
  },
}];
