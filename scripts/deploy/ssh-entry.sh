#!/bin/bash
# 배포 키의 진입점(설계 4절 "배포", 결정 기록 2026-10-13-gh26-ssh-push-deploy).
# 서버 deploy 계정의 authorized_keys에서 command=로만 실행한다. 이 키로는 "deploy vX.Y.Z" 말고 아무것도 실행되지 않는다.
#   command="/usr/local/bin/meeting-bot-deploy",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 …
# 서버에 한 번 설치한다: sudo install -m 755 scripts/deploy/ssh-entry.sh /usr/local/bin/meeting-bot-deploy
# 이 파일을 고치면 서버에 다시 설치해야 한다. 배포 절차 자체는 태그 안의 scripts/deploy/deploy.sh가 정한다.
set -euo pipefail

APP_DIR=${MEETING_BOT_DIR:-/opt/meeting-bot}
request=${SSH_ORIGINAL_COMMAND:-}

if [[ ! $request =~ ^deploy\ (v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})$ ]]; then
  echo "[deploy] 허용하지 않는 요청입니다. 'deploy vX.Y.Z'만 받습니다" >&2
  exit 64
fi
tag=${BASH_REMATCH[1]}

cd "$APP_DIR"
# 배포가 겹치지 않게 잠근다. 잠금은 아래 exec로 넘어간 배포 스크립트가 끝날 때까지 유지된다.
exec 9>"$APP_DIR/.deploy.lock"
if ! flock -n 9; then
  echo "[deploy] 다른 배포가 진행 중입니다" >&2
  exit 75
fi

git fetch --quiet --force --tags origin
if ! git rev-parse --verify --quiet "refs/tags/$tag^{commit}" >/dev/null; then
  echo "[deploy] 저장소에 없는 태그입니다: $tag" >&2
  exit 65
fi

# 체크아웃하기 전에 그 태그의 배포 스크립트를 실행한다. 회의 중이면 아무것도 바꾸지 않고 끝내야 하기 때문이다.
exec bash -c "$(git show "refs/tags/$tag:scripts/deploy/deploy.sh")" deploy.sh "$tag"
