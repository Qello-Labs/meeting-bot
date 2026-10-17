# Decision Record: 회의록 템플릿과 승인된 회의록을 Confluence로 옮김

> Created at: `2026-10-17`
> GitHub Issue: `#31` (대체: #30 YouTrack 이전)
> Status: Accepted (1~4는 사용자 결정. 5~8은 작업 판단이며 PR 리뷰에서 확인받는다)

## Context

2026-10-17 팀 문서가 ClickUp에서 Atlassian Confluence로, 스프린트 등 일정 관리가 Jira로 모두 옮겨졌다.
지금 워크플로(`회의 녹취`)는 ClickUp v3 API를 네 번 부른다.

| 노드 | ClickUp(2026-10-11~16) |
| --- | --- |
| 템플릿 읽기 | 템플릿 페이지를 Markdown(`content_format=text/md`)으로 읽는다 |
| 페이지 목록 읽기, 쓰기 판단 | `회의록` 페이지 아래에 같은 이름(`YYYY-MM-DD 정기 회의`)이 있으면 쓰지 않는다 |
| 페이지 만들기 | `회의록` 아래에 하위 페이지를 Markdown으로 만든다. 재시도하지 않는다 |
| 페이지 다시 읽기, 내용 대조 | 다시 읽은 제목·상위 페이지·본문 줄을 보낸 것과 대조한다 |

옮긴 결과(Confluence `Qello 마이그레이션 검증 기록` 페이지): Qello 스페이스(키 `SCRUM`)의 Team Docs 아래 `회의록` 페이지와 하위 회의록,
스페이스 홈 아래 `회의록 템플릿` 페이지가 있다. 템플릿은 ClickUp에서 옮겨 와서 표 머리글이 일반 칸이고, 제목마다 앵커 매크로가 붙어 있다.

Confluence REST API에는 Markdown으로 읽거나 쓰는 표현이 없다. v2 페이지 API는 읽기에 `storage`, `atlas_doc_format`, `view` 등을,
쓰기에 `storage`, `atlas_doc_format`, `wiki`를 받는다. v1의 본문 변환 API도 Markdown을 지원하지 않는다.

## Decision

1. (사용자) 승인된 회의록은 Confluence Qello 스페이스의 Team Docs > `회의록` 페이지 아래 하위 페이지 `YYYY-MM-DD 정기 회의`로 쓴다.
2. (사용자) 템플릿은 실행할 때마다 Confluence `회의록 템플릿` 페이지에서 읽는다(2026-10-10 결정 유지).
3. (사용자) 자격 증명은 Atlassian 클래식(범위 없는) API 토큰 1개를 n8n Basic Auth(계정 이메일 + 토큰)로 등록한다.
   범위를 고른 토큰 2개(Confluence용, Jira용)보다 설정이 단순하다.
4. (사용자) 하네스 문서(`AGENTS.md`, `CLAUDE.md`, `.claude/**`, Issue 폼, PR 템플릿, 작업 계약 템플릿)의 ClickUp 언급도 Confluence·Jira로 바꾼다.
   정책(승인 게이트, 비밀값 검사, 금지 행위)은 완화하지 않는다.
5. (작업 판단) 워크플로 안에서는 지금처럼 Markdown을 다룬다. Code 노드가 같이 쓰는 `workflows/src/shared/confluence-format.js`가
   템플릿 저장 형식을 Markdown으로, 승인된 Markdown을 저장 형식으로 바꾼다. 초안 작성 지시, 근거 검증 규칙, Discord 표시, 수정 모달은 그대로다.
   다루는 요소는 회의록에 나오는 것(제목, 문단, 목록, 표, 인용, 구분선, 코드 블록, 굵게, 인라인 코드, 링크, 줄바꿈)뿐이다.
   매크로는 본문이 있으면 본문만 남기고 없으면 지운다. 표의 첫 행은 머리글로 본다.
6. (작업 판단) 같은 이름 확인은 `회의록` 아래가 아니라 스페이스 전체 제목 검색(`GET /wiki/api/v2/pages?space-id&title`)으로 한다.
   Confluence는 한 스페이스 안에서 페이지 제목이 겹칠 수 없어서, `회의록` 아래만 보면 다른 곳의 같은 제목 때문에 만들기가 실패한다.
7. (작업 판단) 사이트 주소(`https://tkv123.atlassian.net`), 스페이스 ID·키, 페이지 ID는 코드 상수로 둔다. ClickUp 워크스페이스·문서 ID를
   코드 상수로 두던 것과 같다(2026-10-11 사용자 결정). 사이트 주소는 팀 SaaS 주소이고 우리 서버 주소가 아니다(AGENTS.md 6절의 서버 주소와 다르다).
   주소를 `.env`로 빼면 배포 스크립트가 워크플로를 고쳐야 하고 n8n 설정을 열어야 하는데, 얻는 것이 없다.
8. (작업 판단) 다시 읽은 대조는 저장 형식을 Markdown으로 바꾼 뒤 보낸 Markdown과 줄 단위로 비교한다. 공백, 목록 기호, 번호 목록의 번호,
   표 구분선, 역슬래시 이스케이프, `<br>` 차이는 같은 것으로 본다. ClickUp용 Markdown 보정(인용 뒤 빈 줄, `~` 이스케이프 등)은 지운다.
   preflight에 Atlassian API 토큰 패턴(`ATATT…`)을 더하고 ClickUp 토큰 패턴은 남긴다.

## Rationale

- 하위 페이지는 지금 구조와 같다. 같은 이름 확인, 쓰기 1회(재시도 없음), 다시 읽어 대조하는 안전장치와 승인 게이트를 그대로 옮길 수 있다.
- Markdown을 워크플로 안의 공통 형식으로 남기면 LLM 지시, 근거 검증(구조·근거 링크·녹취 시각), 수정 모달을 바꾸지 않아도 된다.
  저장 형식은 Confluence 경계에서만 다룬다.
- 변환을 코드로 하면 결과가 결정적이고 테스트할 수 있다. LLM에게 저장 형식을 직접 쓰게 하면 근거 검증 코드를 새로 만들어야 하고 형식 오류가 늘어난다.
- Basic Auth는 n8n 기본 자격 증명이라 노드를 새로 깔지 않는다. 배포 스크립트는 종류별로 하나일 때만 붙이므로 다른 Basic Auth 자격 증명과 섞이지 않는다.

## Alternatives considered

| Alternative | Advantages | Disadvantages | Reason not selected |
| --- | --- | --- | --- |
| LLM이 저장 형식(XHTML)을 직접 채움 | 변환 코드가 없다 | 근거 검증·수정 모달을 새로 만들어야 한다. 형식 오류가 늘어난다 | 결정적 처리는 코드가 한다(AGENTS.md 3.2) |
| ADF(`atlas_doc_format`)로 읽고 씀 | 편집기와 같은 형식이다 | JSON 트리라 변환 코드가 길고 대조가 어렵다 | 저장 형식이 더 단순하다 |
| `wiki` 표현으로 쓰기 | Markdown과 비슷하다 | 읽을 때는 `wiki`가 없어 대조할 수 없다. 표·링크 문법이 다르다 | 다시 읽어 대조할 수 없다 |
| 템플릿을 저장소 파일로 고정 | 외부 호출이 하나 준다 | 템플릿을 바꾸려면 PR과 배포가 필요하다 | 2026-10-10 결정(실행 때 읽기) 유지 |
| 범위를 고른 토큰 2개 | 토큰이 새도 피해가 범위 안이다 | 같은 종류 자격 증명이 둘이라 반영 스크립트와 노드 구분이 필요하다 | 사용자가 클래식 토큰 1개를 골랐다 |
| 같은 이름을 `회의록` 아래에서만 확인 | ClickUp 때와 같다 | 스페이스 다른 곳의 같은 제목이면 만들기가 400으로 실패한다 | 스페이스 전체 검색이 정확하다 |
| 사이트 주소를 `.env`로 | 저장소에 주소가 없다 | 배포 스크립트가 워크플로를 고쳐야 한다. Code 노드 환경 변수 접근을 열면 다른 비밀값도 보인다 | 비밀값이 아니고 얻는 것이 없다 |

## Evidence

공식 문서(조회일 2026-10-17)와 Atlassian 연결로 읽은 실제 스페이스.

- [Confluence REST API v2: Page](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/): `POST /pages`는 `spaceId`, `status`,
  `title`, `parentId`, `body`를 받는다. 쓰기 표현은 `storage`, `atlas_doc_format`, `wiki`다. `GET /pages`는 `space-id`, `title`로 거른다.
- [Confluence REST API v1: Content body](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content-body/): 변환은
  `storage`, `atlas_doc_format`, `editor`, `view` 사이에서만 된다. Markdown은 없다.
- [API 토큰 관리](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/): 토큰은 Basic Auth의
  비밀번호 자리에 쓴다. 만료는 1~365일이다. 범위 없는 토큰은 사이트 주소로 부른다.
- 실제 스페이스(2026-10-17): `회의록 템플릿` 본문의 구조(필드 표, `##` 제목, 액션 아이템 표)를 ADF로 읽어 확인했다. 저장 형식 자체는
  운영 확인 전까지 테스트 fixture(`test/e2e/template.js`)로 흉내 낸 것이다.
- 오프라인 테스트와 E2E(실제 n8n 2.42.6, 가짜 Confluence)에서 Basic Auth 헤더, 템플릿 변환, 쓰기 요청, 같은 제목 확인, 대조, 실패 알림을 확인했다.
- 확인할 것: 실제 Confluence가 저장하며 바꾸는 모양(대조 통과 여부), 같은 제목 검색 응답.

## Data and cost

- 외부로 전송되는 데이터: 승인된 회의록(녹취와 결정 메시지로 만든 요약, 결정과 근거 링크·녹취 시각, 참석자 표시 이름)이 ClickUp 대신
  Atlassian Confluence에 간다. 녹음 파일과 녹취 원문은 보내지 않는다. 팀 문서가 이미 Confluence에 있어 보관 위치는 팀 문서와 같다.
- 팀 동의 범위와의 관계: 회의록을 올리는 서비스가 팀 문서 서비스와 같이 바뀌었다. 첫 실제 회의 전에 팀에 알린다.
- 예상 호출량: 회의당 Confluence 호출 4회(템플릿 읽기, 같은 제목 찾기, 만들기, 다시 읽기). OpenAI 호출 수는 그대로다. Confluence 요금은 지금 요금제 그대로다.
- 교체 시 영향: 반영할 때 승인을 기다리던 실행은 옛 정의(ClickUp)로 끝난다(2026-10-13 실험). 승인 대기 실행이 없을 때 반영한다.
  반영 뒤 n8n의 ClickUp 자격 증명은 지우고 ClickUp 토큰은 폐기한다. 결정 메시지 기간의 시작(static data)은 그대로 이어진다.

## Consequences

### Positive

- 같은 이름 확인, 쓰기 1회, 다시 읽어 대조하는 안전장치와 승인 게이트가 그대로 남는다.
- LLM 지시와 근거 검증 코드가 바뀌지 않는다.

### Negative / risks

- 클래식 토큰은 만든 계정의 권한을 모두 가진다. 토큰은 n8n 자격 증명에만 두고 만료일(최대 1년)을 관리해야 한다.
- 변환 코드가 다루지 않는 서식(색, 패널 등)을 팀이 템플릿에 넣으면 LLM에게는 글자만 간다.
- 실제 Confluence가 저장하며 바꾸는 모양이 테스트와 다르면 대조가 "확인 필요"를 낸다. 페이지는 남으므로 운영 확인에서 보고 규칙을 더한다.
- 사이트 주소가 저장소에 있다(비밀값은 아니다).

## Revisit conditions

- 실제 Confluence 확인에서 대조가 맞지 않을 때
- 팀이 템플릿에 변환 코드가 다루지 않는 서식을 넣을 때
- Atlassian이 범위 없는 토큰을 막을 때

## Approval

- Approvers: 사용자(1~4번, 2026-10-17). 5~8번은 PR 리뷰에서 확인
- Approved at: 2026-10-17
