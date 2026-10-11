// 회의 채널 메시지 중 결정 메시지를 코드로 고른다(설계 5절 D, AGENTS.md 3.2). LLM은 결정 여부를 판단하지 않는다.
// 기간 안에 사람이 쓴 메시지(봇·Webhook·시스템 메시지 제외) 중 ✅ 반응이 1개 이상인 것만 고른다.
// 메시지 원문은 이 노드 출력(n8n 실행 기록, 7일 보관)에만 남긴다. 작성자 ID는 남기지 않는다.
const DISCORD_EPOCH = 1420070400000n;
// 일반 메시지(0)와 답장(19)만 사람이 쓴 글로 본다. 입장·고정 알림 같은 시스템 메시지는 뺀다.
const HUMAN_TYPES = new Set([0, 19]);

// 녹취 갈래와 따로 실행되므로(병렬 갈래) 녹취 결과를 읽지 않는다. 알림 문구는 알림 만들기 노드가 만든다.
const period = $('결정 메시지 기간').first().json;

// Discord 메시지 ID는 길이가 다를 수 있어 길이부터 비교한다.
const isAfter = (a, b) => a.length > b.length || (a.length === b.length && a > b);
const msOf = (id) => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);

// 조회 노드는 메시지 하나를 항목 하나로 낸다. 받은 메시지가 없으면 alwaysOutputData로 빈 항목 하나가 온다.
// 페이지 넘김 중 오류 응답을 받으면 n8n이 오류 본문을 출력 항목으로 낼 수 있어서(n8n 2.42.6 E2E에서 확인),
// 메시지도 빈 항목도 아닌 것이 있으면 결정이 조용히 0개가 되지 않게 실패시킨다.
const isMessage = (m) => typeof m?.id === 'string' && /^\d+$/.test(m.id);
const items = $input.all().map((item) => item.json);
const unexpected = items.filter((m) => !isMessage(m) && Object.keys(m ?? {}).length > 0);
if (unexpected.length > 0) {
  throw new Error(`결정 메시지 조회 결과에 메시지가 아닌 항목이 ${unexpected.length}개 있습니다. Discord 조회가 실패했을 수 있습니다`);
}
const messages = items.filter(isMessage);

// n8n 페이지 넘김은 요청 한도에 닿으면 오류 없이 멈춘다. 한도만큼 받았는데 회의 종료 시각에 닿지 못했으면
// 더 받을 메시지가 남은 것이라 결정이 조용히 빠지지 않게 실패시킨다(2026-10-11 사용자 결정).
const newest = messages.reduce((a, m) => (isAfter(m.id, a) ? m.id : a), '0');
if (messages.length >= period.maxRequests * 100 && !isAfter(newest, period.endId)) {
  throw new Error(`회의 채널 메시지를 ${messages.length}개까지 받고도 회의 종료 시각에 닿지 못했습니다. 기간(${period.from} ~ ${period.to})을 확인해 주세요`);
}

const inWindow = (m) => isAfter(m.id, period.afterId) && !isAfter(m.id, period.endId);
const byHuman = (m) => HUMAN_TYPES.has(m.type) && !m.author?.bot && !m.webhook_id;
const checked = (m) => (m.reactions ?? []).some((r) => r?.emoji?.name === '✅' && Number(r.count) >= 1);
const picked = messages
  .filter((m) => inWindow(m) && byHuman(m) && checked(m))
  .sort((a, b) => (isAfter(a.id, b.id) ? 1 : -1));

// Message Content Intent가 꺼져 있으면 다른 사람 메시지 내용이 빈 문자열로 온다. 빈 결정이 회의록에 들어가지 않게 실패시킨다.
const blank = picked.filter((m) => String(m.content ?? '').trim() === '' && !(m.attachments ?? []).length);
if (blank.length > 0) {
  throw new Error(`✅가 달린 메시지 ${blank.length}개의 내용이 비어 있습니다. Discord 봇의 Message Content Intent가 켜져 있는지 확인해 주세요`);
}

const decisions = picked.map((m) => ({
  link: `https://discord.com/channels/${period.guildId}/${period.channelId}/${m.id}`,
  author: m.author?.global_name || m.author?.username || '알 수 없음',
  content: String(m.content ?? ''),
  attachments: (m.attachments ?? []).map((a) => a.filename),
  sentAt: new Date(msOf(m.id)).toISOString(),
}));

return [{
  json: {
    guildId: period.guildId,
    textChannelId: period.channelId,
    from: period.from,
    to: period.to,
    scanned: messages.length,
    decisionCount: decisions.length,
    decisions,
  },
}];
