// 고른 액션 아이템마다 Jira 이슈 만들기 요청을 만든다(#32). 만들 것이 없으면 { create: false } 하나를 내 새 이슈 확인(If)이 건너뛰게 한다.
// - 같은 회의 레이블 이슈 중 할 일(요약)이 같은 것이 있으면 새로 만들지 않고 그 키를 쓴다. 다시 처리해도 이슈가 두 번 생기지 않는다.
// - 스프린트(2026-10-17 사용자 결정): 이름이 담당 파트로 시작하는 진행 중·예정 스프린트(`Backend·Sprint 3` 등) 중 기한이 기간 안에 드는 것
//   하나에 넣는다. 기한이 없거나, 맞는 스프린트가 없거나 둘 이상이면 백로그에 둔다. 기간은 한국 날짜로 비교한다.
// - 담당자 칸은 Jira 계정을 찾지 않고 비운다. 회의록의 담당자 이름은 설명에 적는다.
// JIRA(사이트·프로젝트·보드·이슈 유형·스프린트 필드)는 scripts/build-workflow.js가 이 코드 앞에 붙인다.
const picked = $('액션 아이템 고르기').first().json;
const prepared = $('쓰기 준비').first().json;
const found = $('같은 회의 이슈 찾기').first().json;
const sprintList = $('스프린트 읽기').first().json;

if (!Array.isArray(found?.issues)) throw new Error('Jira 이슈 검색 응답에 issues가 없습니다');
if (!Array.isArray(sprintList?.values)) throw new Error('Jira 스프린트 목록 응답에 values가 없습니다');

const kstDate = (iso) => {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : null;
};
const sprints = sprintList.values
  .filter((s) => ['active', 'future'].includes(s?.state))
  .map((s) => ({ id: s.id, name: String(s.name ?? ''), start: kstDate(s.startDate), end: kstDate(s.endDate) }));
const sprintFor = (part, due) => {
  if (!due || !part) return null;
  const prefix = part.toLowerCase();
  const matches = sprints.filter((s) => s.name.toLowerCase().startsWith(prefix) && /sprint/i.test(s.name)
    && s.start && s.end && s.start <= due && due <= s.end);
  return matches.length === 1 ? matches[0] : null;
};

const reused = new Map(found.issues.map((issue) => [String(issue?.fields?.summary ?? '').trim(), issue.key]));
const text = (value) => ({ type: 'paragraph', content: value ? [{ type: 'text', text: value }] : [] });

const plans = picked.rows.map((row, i) => {
  const summary = row.task.replace(/\s+/g, ' ').slice(0, 255);
  const key = row.existingKey ?? reused.get(summary) ?? null;
  const sprint = key ? null : sprintFor(row.part, row.due);
  return {
    row: i,
    key,
    sprint: sprint ? sprint.name : null,
    request: key ? null : {
      fields: {
        project: { key: JIRA.projectKey },
        issuetype: { id: JIRA.issueTypeId },
        summary,
        labels: ['meeting-minutes', picked.label],
        ...(row.due ? { duedate: row.due } : {}),
        ...(sprint ? { [JIRA.sprintField]: sprint.id } : {}),
        description: {
          type: 'doc',
          version: 1,
          content: [
            text(`회의록: ${prepared.name} (Confluence 회의록)`),
            text(`담당 파트: ${row.part || '없음'}`),
            text(`담당자(회의록 기준): ${row.owner || '없음'}`),
            text(`meeting-bot이 승인된 회의록(회의 ${picked.meetingId})에서 만들었습니다.`),
          ],
        },
      },
    },
  };
});

const toCreate = plans.filter((p) => p.request);
// 이슈 만들기 응답은 요청 순서대로 온다. 회의록에 이슈 채우기가 row로 plans와 짝짓는다.
if (toCreate.length === 0) return [{ json: { create: false, plans } }];
return toCreate.map((p) => ({ json: { create: true, row: p.row, request: p.request, plans } }));
