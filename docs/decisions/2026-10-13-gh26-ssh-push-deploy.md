# Decision Record: GitHub Actions가 SSH로 서버에 배포

> Created at: `2026-10-13`
> GitHub Issue: `#26`
> Status: Accepted (사용자 결정, 2026-10-13)

## Context

#24에서 Oracle 서버(인바운드 SSH만, n8n은 `127.0.0.1`)에 수동으로 배포했다. #26은 릴리스 태그를 승인하면 녹음 봇 이미지와 n8n 워크플로를
서버에 자동으로 배포한다. 저장소는 공개다([공개 결정](2026-10-13-gh24-public-repo.md)).

GitHub Actions가 서버에 배포하려면 서버에 들어가는 길이 필요하다. 지금까지 서버에 SSH로 들어가는 것은 사람뿐이었다.
`AGENTS.md` 3.4는 서버 접근 경로 변경에 결정 기록과 사람 승인을 요구한다.

## Decision

GitHub Actions의 `production` 환경 작업이 배포 전용 SSH 키로 서버의 `deploy` 계정에 접속해 배포 스크립트 하나만 실행한다.
인바운드 포트는 그대로 SSH(22)만 연다.

## Rationale

- 배포가 승인 직후 바로 일어나고 기록이 GitHub Actions에 남는다(사용자 결정).
- 새 포트를 열지 않는다. GitHub 실행기는 이미 열린 SSH로 들어온다.
- 키가 새도 할 수 있는 일을 줄인다.
  - 서버 `authorized_keys`의 `command=`로 이 키는 배포 스크립트만 실행한다. 인자는 `vX.Y.Z` 형식 태그만 받는다.
  - `no-port-forwarding`, `no-agent-forwarding`, `no-X11-forwarding`, `no-pty`를 붙인다.
- 비밀값은 `production` 환경 비밀값에만 둔다(배포 키, 서버 주소, 서버 호스트 키). 환경 승인을 통과한 작업만 읽는다. 서버 주소는 공개 로그에 나오지 않는다.
- 접속할 때 서버 호스트 키를 고정 확인해, 다른 서버로 바꿔치기되는 것을 막는다.
- 배포 작업은 태그 push와 수동 실행에서만 돈다. 포크에서 온 PR은 환경 비밀값을 받지 못한다.

## Alternatives considered

| Alternative | Advantages | Disadvantages | Reason not selected |
| --- | --- | --- | --- |
| Pull: 서버 타이머가 새 릴리스를 확인해 스스로 배포 | 인바운드와 GitHub 비밀값이 바뀌지 않는다 | 배포까지 몇 분 지연, 배포 기록이 서버에 남는다 | 사용자가 Push를 골랐다(추천안이었음) |
| 서버에 자체 실행기(self-hosted runner) | 서버 안에서 바로 실행 | 공개 저장소에서는 누구나 PR로 그 실행기에서 코드를 돌릴 수 있다 | GitHub 문서가 공개 저장소에 쓰지 말라고 권한다 |

## Evidence

- GitHub 환경(2026-10-13 조회): 공개 저장소는 모든 요금제에서 환경을 쓸 수 있고, 승인자는 최대 6명이며 그중 한 명이 승인하면 된다. "Prevent self-review"로 실행한 본인의 승인을 막을 수 있다.
  https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment
- 자체 실행기(2026-10-13 조회): 공개 저장소에서는 자체 실행기를 거의 쓰지 말라고 권한다.
  https://docs.github.com/en/actions/reference/security/secure-use
- 요금(2026-10-13 조회): 공개 저장소에서 기본 GitHub 실행기(arm64 `ubuntu-24.04-arm` 포함)는 무료다.
  https://docs.github.com/en/billing/reference/actions-runner-pricing

## Data and cost

- 외부로 전송되는 데이터와 제공자의 학습 사용·보존 정책: 바뀌지 않는다. 배포는 코드와 이미지만 다룬다.
- 팀 동의 범위와의 관계: 해당 없음.
- 예상 호출량과 회의당 비용: 0원(공개 저장소의 기본 실행기).
- 교체 시 영향: 키를 지우면(`authorized_keys`, GitHub 환경 비밀값) 바로 수동 배포로 돌아간다.

## Consequences

### Positive

- 승인한 릴리스만 서버에 간다. 배포 기록이 GitHub에 남는다.

### Negative / risks

- 서버에 들어올 수 있는 주체에 GitHub Actions가 늘어난다.
- `deploy` 계정은 Docker를 다뤄야 해서 사실상 서버 관리자 권한과 같다. `command=`로 실행할 수 있는 명령을 막는 것이 핵심 방어다.
- 배포 스크립트 자체에 결함이 있으면 그 범위 안에서 악용될 수 있다(인자 검증을 테스트로 지킨다).

## Revisit conditions

- 배포 키가 샐 의심이 있을 때(키를 지우고 다시 만든다)
- GitHub 실행기의 SSH 접속이 막히거나 GitHub IP 대역으로 출발지를 좁혀야 할 때
- 다른 자동화가 같은 서버에 올라와 배포 범위를 나눠야 할 때

## Approval

- Approvers: 사용자(2026-10-13 Push 방식 선택)
- Approved at: 2026-10-13
