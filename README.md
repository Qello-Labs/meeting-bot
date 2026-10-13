# meeting-bot

Discord 회의를 말하는 사람별로 녹음하고, n8n 워크플로가 음성 인식과 회의록 초안 작성을 거쳐
승인된 회의록을 ClickUp에 올리는 봇이다.

| 문서 | 내용 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 사람과 AI 에이전트의 공통 작업 계약 |
| [CLAUDE.md](CLAUDE.md) | Claude Code 진입점, 프로젝트 Skill |
| [docs/harness/OVERVIEW.md](docs/harness/OVERVIEW.md) | 하네스 구성, 출처, 다음 단계 |
| [templates/](templates) | 작업 계약(`TASK.md`), 결정 기록 양식 |
| [docs/design/meeting-notes.md](docs/design/meeting-notes.md) | 회의록 자동화 설계 |
| [docs/decisions/](docs/decisions) | 결정 기록 |
| [workflows/README.md](workflows/README.md) | n8n 워크플로 빌드, 가져오기, 차이 검사, E2E |

## 녹음 봇

`/회의녹음 시작`부터 `/회의녹음 종료`까지만 음성 채널에 들어가 말하는 사람별로 녹음한다.
n8n이 회의 채널에 올린 회의록 초안의 `승인`·`수정`·`거절` 버튼과 수정 모달도 처리한다.

```
/회의녹음 시작 ─> 발화마다 .ogg 저장 ─> /회의녹음 종료
   ─> 짧은 발화 제거, webm 변환, manifest.json 작성 ─> n8n Webhook 호출
```

| 경로 | 내용 |
| --- | --- |
| `src/index.js` | 명령 처리, 녹음 시작과 종료, 연결 끊김 처리 |
| `src/recorder.js` | 음성 채널 연결, 발화별 녹음, 종료 순서 |
| `src/finalize.js` | 짧은 발화 제거, webm 변환, manifest 작성, n8n 호출 |
| `src/approval.js` | 회의록 초안의 승인·수정·거절 버튼과 수정 모달을 n8n 재개 주소로 전달하고 n8n의 판단을 누른 사람에게 알림 |
| `src/commands.js`, `src/deploy-commands.js` | `/회의녹음` 명령 정의와 등록 |
| `scripts/offline-test.js` | Discord 없이 녹음, 종료, 변환, manifest 작성 확인 |

### Discord 준비

1. [Discord 개발자 포털](https://discord.com/developers/applications)에서 Application을 만들고 Bot 토큰을 발급한다.
2. Bot 설정에서 **Message Content Intent**를 켠다. 녹음 봇에는 필요 없고, n8n이 같은 토큰으로 회의 채널의 결정 메시지를 읽을 때 필요하다.
   꺼져 있으면 메시지 내용이 비어 와서 회의 녹취 워크플로가 실패한다.
3. OAuth2 URL Generator에서 scope는 `bot`, `applications.commands`를 고르고, 권한은 채널 보기, 메시지 보내기, 링크 임베드,
   파일 첨부, 메시지 기록 보기, 연결을 골라 팀 서버에 초대한다. 관리자 권한은 주지 않는다.

### 로컬에서 실행

```bash
cp .env.example .env   # DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID 채우기
npm ci
npm run deploy-commands   # /회의녹음 명령 등록. 한 번만 하면 된다
npm start
```

n8n 없이 녹음만 확인할 때는 `.env`의 `MEETING_ENDED_WEBHOOK_URL`을 비워 둔다.
승인 버튼은 같은 주소의 n8n(`<origin>/webhook-waiting/…`)을 부른다. 로컬 n8n과 함께 확인할 때는
`MEETING_ENDED_WEBHOOK_URL=http://127.0.0.1:5678/webhook/meeting-ended`로 실행한다.

### 서버에서 실행 (녹음 봇 + n8n)

Oracle Cloud Always Free의 Ampere A1(arm64)을 쓴다. Always Free는 홈 리전에서만 쓸 수 있고 A1은 춘천에서 만들 수 없어
홈 리전을 서울로 고른다. 인바운드 포트는 SSH만 연다.

서버에는 배포 전용 `deploy` 계정이 `/opt/meeting-bot`을 소유한다. 처음 한 번은 사람이 띄우고, 그 뒤 업데이트는 릴리스 배포로 한다(아래 "릴리스와 배포").

```bash
sudo adduser --disabled-password --gecos "" deploy && sudo usermod -aG docker deploy
sudo mkdir -p /opt/meeting-bot && sudo chown deploy:deploy /opt/meeting-bot
sudo -u deploy git clone https://github.com/Qello-Labs/meeting-bot.git /opt/meeting-bot
cd /opt/meeting-bot
sudo -u deploy sh -c 'umask 077; printf "DISCORD_TOKEN=\nN8N_ENCRYPTION_KEY=%s\nN8N_DEPLOY_API_KEY=\n" "$(openssl rand -hex 32)" > .env'
sudo -u deploy nano .env   # DISCORD_TOKEN, N8N_DEPLOY_API_KEY(n8n을 띄우고 만든 뒤) 채우기
sudo -u deploy docker compose up -d --build
```

`.env`에는 이 세 값만 둔다. `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`는 슬래시 명령 등록(`npm run deploy-commands`)에만 쓰고,
OpenAI·ClickUp 키는 n8n 자격 증명에 둔다. `RECORDER_TAG`는 릴리스 배포가 적는다.

| 항목 | 설정 |
| --- | --- |
| n8n 접근 | 서버의 `127.0.0.1:5678`에만 열린다. 내 PC에서 `ssh -L 5678:localhost:5678 <서버>` 후 `http://localhost:5678` |
| `N8N_ENCRYPTION_KEY` | 없으면 compose가 시작하지 않는다. n8n이 자격 증명을 이 키로 암호화하므로 서버 밖에도 보관한다. 잃으면 다른 서버로 옮길 때 자격 증명을 다시 등록해야 한다 |
| 녹음 | `recordings` volume. 녹음 봇은 쓰고 n8n은 읽기만 한다. n8n 파일 읽기는 `/recordings`로 제한한다 |
| 보관 | 녹음은 끝난 지 7일 뒤 녹음 봇이 지우고(켜질 때와 하루 한 번), n8n 실행 기록은 7일 뒤 n8n이 지운다 |
| 재시작 | 두 컨테이너 모두 `restart: unless-stopped`. 회의 중 재시작되면 10분 안이면 같은 회의로 이어 간다 |
| 시간대 | 녹음 봇과 n8n 모두 `Asia/Seoul`. 회의 폴더 이름이 한국 시각이 된다 |
| 워크플로 | 저장소 `workflows/`가 n8n의 `/workflows`에 읽기 전용으로 연결된다. 회의 녹취와 실패 알림 두 개를 가져오고, 실패 알림용 n8n API 키를 만든다. 방법은 [workflows/README.md](workflows/README.md) |

n8n 편집 화면을 처음 열면 관리자 계정을 만든다. n8n 2.42.6은 로그인 쿠키를 HTTPS에서만 보내지만 Chrome은 `http://localhost`를
안전한 주소로 보기 때문에 SSH 포트 포워딩으로도 로그인된다(Chrome에서 확인).

### 릴리스와 배포

main에 병합해도 서버는 바뀌지 않는다. `vX.Y.Z` 태그를 올리고 `production` 환경에서 승인하면 GitHub Actions(`.github/workflows/release.yml`)가
검사 → arm64 녹음 봇 이미지(GHCR) → 승인 → SSH 배포 → GitHub Release 순으로 진행한다. 설계와 결정은 [설계 문서 4절 "배포"](docs/design/meeting-notes.md)에 있다.

```bash
git fetch origin && git tag v1.2.3 origin/main && git push origin v1.2.3   # 그다음 Actions 화면에서 production 승인
```

| 상황 | 하는 일 |
| --- | --- |
| 되돌리기 | Actions → Release → Run workflow에서 이전 태그를 넣는다. Release는 새로 만들지 않는다 |
| 회의 중(종료 코드 75) | 녹음 중이면 아무것도 바꾸지 않고 멈춘다. 회의가 끝난 뒤 실패한 실행을 다시 돌린다(Re-run) |
| 실패(1) | 이전 태그로 되돌렸다. Actions 로그에서 원인을 본다 |
| 실패(2 등) | 되돌리지 못했다. 서버에서 `sudo -u deploy docker compose ps`와 n8n 화면을 확인한다 |

서버가 하는 일(`scripts/deploy/deploy.sh`): 회의 중이면 멈춤 → 태그 체크아웃 → `.env`의 `RECORDER_TAG` 갱신 → GHCR 이미지로 녹음 봇만 교체
→ "준비 완료" 로그 확인 → n8n 워크플로 반영(공개 API, [workflows/README.md](workflows/README.md)) → 실패하면 이전 태그로 되돌림.
n8n 컨테이너, `.env`의 다른 값, n8n 자격 증명은 바꾸지 않는다.

처음 한 번 설정할 것:

1. 진입 스크립트 설치: `sudo install -o root -g root -m 755 scripts/deploy/ssh-entry.sh /usr/local/bin/meeting-bot-deploy`
   (이 파일을 고치면 다시 설치한다).
2. 배포 전용 키(암호 없음)를 만들어 공개 키를 `/home/deploy/.ssh/authorized_keys`(700/600, deploy 소유)에 다음 형식으로 넣는다.
   이 키로는 `deploy vX.Y.Z` 말고는 실행되지 않고 포트 포워딩도 막힌다.

   ```
   command="/usr/local/bin/meeting-bot-deploy",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 …
   ```

3. n8n 화면에서 배포용 API 키를 만들어(범위 `workflow:read`, `workflow:update`, `workflow:activate`, `credential:list`, `execution:list`)
   `.env`의 `N8N_DEPLOY_API_KEY`에 넣는다. 실패 알림용 키(`execution:read`)와 따로 둔다.
4. GitHub Settings → Environments → `production`: Required reviewers, 배포 대상은 `main` 브랜치와 `v*` 태그,
   비밀값 `DEPLOY_SSH_KEY`(개인 키), `DEPLOY_HOST`(서버 주소), `DEPLOY_KNOWN_HOSTS`(`ssh-keyscan -t ed25519 <서버>`. 서버의
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 지문과 대조한 줄).
5. 첫 릴리스 뒤 GHCR 패키지(`meeting-bot-recorder`)가 공개인지 확인한다. 서버는 로그인 없이 이미지를 받는다.

### 결과물

```
recordings/20261013-1400/
├── manifest.json
└── segments/
    ├── 000012345-123456789012345678.webm   # 회의 시작 후 12.345초, 해당 사용자 ID
    └── ...
```

`manifest.json`에는 회의 시작과 끝 시각, 참석자 이름, 발화마다 파일 이름, 화자, 시작과 끝(회의 시작 기준 ms)이 들어 있다.

- 발화는 1초 동안 조용하면 끝난 것으로 보고, `MIN_SEGMENT_MS`(기본 700ms)보다 짧은 발화는 버린다.
- OpenAI 음성 인식은 ogg를 받지 않아서 Opus를 다시 인코딩하지 않고 webm으로만 옮긴다.
- 종료할 때는 진행 중인 발화를 끝까지 쓴 뒤 음성 연결을 끊는다. 연결부터 끊으면 라이브러리가 스트림을 닫아 마지막 조각이 잘릴 수 있다.
- 회의 하나는 `/회의녹음 시작`부터 `/회의녹음 종료`까지 이어진다. 봇의 음성 연결이 끊기면 종료 명령을 받을 때까지 같은 회의로 다시 들어가고,
  끊긴 구간을 manifest `gaps`에 남긴다. 음성 채널이 삭제된 경우에만 그때까지의 녹음으로 회의를 끝낸다.
- 회의 중에는 녹음 폴더에 `state.json`을 남긴다. 봇이 재시작되면 10분 안이면 같은 회의로 이어 가고, 더 지났으면 그때까지의 녹음으로 마무리한다.
  manifest를 쓰면 `state.json`은 지운다.
- 봇이 켜질 때와 하루 한 번, 끝난 지 7일이 지난 회의 폴더를 지운다. 끝나지 않은 회의(`state.json`이 있는 폴더)와 회의 ID 형식이 아닌 폴더는 지우지 않는다.
- Ctrl+C로 봇을 끄면 그때까지의 녹음으로 회의를 마무리한다.
- 음성 연결이 준비될 때와 참석자가 바뀔 때 콘솔에 `DAVE 프로토콜 v<버전>`을 남긴다. 0이면 암호화 세션이 없다.

### 알아 둘 점

- Discord는 2026년 3월 1일부터 음성 통화를 종단 간 암호화(DAVE)로만 지원한다. `@discordjs/voice` 0.19에 DAVE 라이브러리
  `@snazzah/davey`가 기본으로 들어 있다. 실제 채널에서 녹음되는지는 #4에서 확인한다.
- `@discordjs/voice` README에 "Audio receive is not documented by Discord so stable support is not guaranteed"라고 적혀 있다.
  Discord가 바꾸면 녹음이 안 될 수 있다.

### 확인하기

```bash
npm test                                   # 녹음 봇 + 워크플로 오프라인 테스트. ffmpeg 필요
docker build -t meeting-bot .
docker run --rm meeting-bot npm run test:recorder   # 이미지에는 workflows/가 없어 녹음 봇 테스트만 돈다
npm run e2e:n8n                            # 실제 n8n + 가짜 OpenAI·Discord·ClickUp. Docker와 openssl 필요, 비용 없음
```

오프라인 테스트는 ffmpeg로 만든 Opus 패킷을 실제 수신 스트림에 넣는다. `offline-test.js`는 녹음, 강제 종료, webm 변환, manifest 작성을,
`offline-reconnect-test.js`는 연결 끊김 뒤 재접속, 채널 이동, 채널 삭제, 봇 재시작 뒤 이어 가기를 가짜 음성 연결로,
`offline-retention-test.js`는 보관 기간이 지난 회의 폴더만 지우는지를,
`offline-approval-test.js`는 승인 버튼 ID 확인, 수정 모달, n8n 재개 요청과 판단 안내, 틀린 서명·끝난 실행·봇 클릭 처리를 가짜 상호작용으로,
`offline-workflow-test.js`는 n8n 워크플로(회의 녹취, 실패 알림)의 Code 노드, 차이 검사, 커밋된 워크플로 JSON이 코드와 같은지를 확인한다.
CI는 `npm test`를 돌린다. `npm run e2e:n8n`은 Docker가 필요해 CI에 넣지 않았다.

## 작업 흐름

1. Meeting Bot 작업 폼으로 GitHub Issue를 만든다.
2. 최신 `main`에서 `<type>/gh-<번호>-<short-slug>` 브랜치를 만든다.
3. `templates/task-contract.md`를 복사해 `TASK.md`를 채운다.
4. 작업 후 `/mb-commit`으로 커밋하고 `/mb-pr`로 PR을 연다. 리뷰는 `/mb-review`와 사람이 한다.
5. 완료 조건과 증빙을 확인한 뒤 Issue를 닫는다.

커밋 전 검사:

```bash
python3 scripts/preflight.py --staged
```
