# Decision Record: n8n 워크플로를 공개 API로 자동 반영

> Created at: `2026-10-13`
> GitHub Issue: `#26`
> Status: Accepted (사용자 결정, 2026-10-13)

## Context

#26의 릴리스 배포에서 n8n 워크플로(`회의 녹취`, `회의 녹취 실패 알림`)도 자동으로 반영하기로 했다(사용자 결정: 완전 자동).
지금까지는 n8n을 멈추고 `import:workflow`로 가져온 뒤 화면에서 자격 증명을 연결하고 Publish했다(#24 4단계). 이 방식은 자동화하기 어렵다.

- 다시 가져오면 워크플로가 꺼지고 자격 증명 연결이 비워진다.
- n8n이 실행 중일 때 가져오면 새 DB에서 깨질 수 있어 멈춰야 한다.
- 승인을 기다리는 실행(최대 3일)이 있을 때 바꿔도 되는지 알 수 없었다.

## Decision

배포 스크립트가 n8n 공개 API로 반영한다. 자격 증명 이름·종류를 조회해 노드에 연결 → `PUT /workflows/{id}` → `POST /workflows/{id}/activate`
→ 켜짐과 연결을 확인한다. 실패하면 반영 전에 읽어 둔 정의로 되돌린다. 승인 대기 실행이 있어도 반영하고, 배포 결과에 그 개수를 적는다.

## Rationale

- n8n을 멈추지 않는다. 자격 증명 연결을 스크립트가 붙이므로 비워지지 않는다.
- 기다리던 실행은 실행에 저장된 옛 정의로 끝나므로(실험 확인) 반영을 미룰 필요가 없다.
- 배포용 API 키는 필요한 범위만 가진다: `workflow:read`, `workflow:update`, `workflow:activate`, `credential:list`, `execution:list`.
  실패 알림용 키(`execution:read`)와 나눈다.

## Alternatives considered

| Alternative | Advantages | Disadvantages | Reason not selected |
| --- | --- | --- | --- |
| CLI `import:workflow`, 자격 증명을 JSON에 미리 붙임 | API 키가 필요 없다 | n8n이 멈추고, 자격 증명 ID를 DB에서 읽어야 한다 | 사용자가 공개 API를 골랐다(추천안) |
| 반자동(워크플로 변경이 있으면 멈추고 사람이 반영) | 사람이 대기 실행을 보고 판단 | 배포가 사람을 기다린다 | 사용자가 완전 자동을 골랐다 |
| 승인 대기 실행이 없을 때만 반영 | 가장 보수적 | 승인이 최대 3일 걸려 그동안 배포가 막힐 수 있다 | 기다리던 실행이 옛 정의로 끝나는 것을 확인했다 |

## Evidence

2026-10-13, n8n 2.42.6 일회용 컨테이너. Webhook → Wait(1분) → HTTP(Discord 자격 증명) 워크플로로 실험했다.

- API 키 범위로 `credential:list`, `execution:list`, `workflow:read/update/activate` 등을 골라 만들 수 있다.
- `GET /api/v1/credentials`는 이름·종류를 준다. `GET /api/v1/executions?status=waiting`이 대기 실행을 준다.
- 켜진 워크플로에 `PUT`(name, nodes, connections, settings)하면 200이고 `versionId`, `activeVersionId`가 새 값이 된다. 노드의 자격 증명 연결이 저장된다.
- `PUT` 직후 Webhook은 옛 정의로 돈다(옛 경로 200, 새 경로 404). `activate` 뒤 새 정의가 등록된다(옛 경로 404, 새 경로 200).
- 실행에 저장된 정의(`execution_data.workflowData`): 고치기 전부터 기다리던 실행은 옛 정의로 재개됐다. `activate` 전에 옛 경로로 시작한 실행도 옛 정의였다.
- static data: 배포 스크립트는 `PUT`에 지금 `staticData`를 그대로 넣는다. #26 E2E 15회차에서 반영 뒤에도 지난 회의 끝 시각이 남는 것을 확인했다.
  넣지 않았을 때 지워지는지는 확인하지 않았다.
- #26 E2E 15회차(실제 n8n 2.42.6, 가짜 외부 서비스): 승인 대기 중에 반영하면 대기 실행 1개를 보고하고, 다시 반영하면 "변경 없음"이며,
  기다리던 회의를 승인하면 옛 정의(가짜 ClickUp 주소)로 끝난다. 반영 뒤 두 워크플로가 켜져 있고 노드마다 자격 증명이 연결돼 있다.

## Data and cost

- 외부로 전송되는 데이터와 제공자의 학습 사용·보존 정책: 바뀌지 않는다. API는 서버 안 compose 네트워크에서만 부른다.
- 팀 동의 범위와의 관계: 해당 없음.
- 예상 호출량과 회의당 비용: 해당 없음.
- 교체 시 영향: 배포용 API 키를 지우면 자동 반영이 멈추고 수동 반영(#24 4단계)으로 돌아간다.

## Consequences

### Positive

- n8n을 멈추지 않고 반영한다. 자격 증명 연결이 유지된다.

### Negative / risks

- 서버에 n8n API 키가 하나 더 생긴다(`.env`, 서버 밖으로 나가지 않음).
- 같은 종류의 자격 증명이 둘 이상이면 어느 것을 붙일지 모호하다. 그때는 반영하지 않고 실패시킨다.
- 이미 기다리던 회의는 옛 정의로 끝나므로, 고친 결함이 그 회의에는 적용되지 않는다.

## Revisit conditions

- n8n 버전을 올릴 때(공개 API와 버전 동작을 다시 확인)
- 자격 증명을 종류별로 둘 이상 써야 할 때

## Approval

- Approvers: 사용자(2026-10-13)
- Approved at: 2026-10-13
