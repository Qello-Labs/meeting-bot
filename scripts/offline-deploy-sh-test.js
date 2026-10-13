// 서버 배포 셸 스크립트(scripts/deploy/ssh-entry.sh, deploy.sh)를 가짜 docker·git·flock으로 실제 실행해 확인한다.
// 가짜 명령은 받은 인자를 기록하고, 환경 변수로 실패를 흉내 낸다. 실제 서버 동작은 #26 6단계(실제 릴리스)에서 확인한다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'scripts/deploy/ssh-entry.sh');
const DEPLOY = path.join(ROOT, 'scripts/deploy/deploy.sh');
const KEY = 'deploy-key-value-for-test';

const FAKES = {
  git: `#!/bin/bash
echo "git $*" >> "$FAKE_LOG"
case "$1" in
  fetch) exit 0 ;;
  rev-parse) ref=\${4#refs/tags/}; ref=\${ref%^\\{commit\\}}; [[ " $FAKE_TAGS " == *" $ref "* ]] ;;
  show) cat "$REAL_DEPLOY_SH" ;;
  checkout) exit 0 ;;
esac`,
  docker: `#!/bin/bash
echo "docker $*" >> "$FAKE_LOG"
tag=$(sed -n 's/^RECORDER_TAG=//p' "$MEETING_BOT_DIR/.env" | tail -n 1)
case "$*" in
  "compose exec -T recorder sh -c "*) echo "\${FAKE_MEETINGS:-0}" ;;
  "compose ps --status running -q recorder") echo container-id ;;
  "compose logs --since "*) [ "$tag" = "$FAKE_NOT_READY_TAG" ] || echo "Qello Meeting Bot#0000 준비 완료. 녹음 저장 위치: /recordings" ;;
  "compose run "*)
    [ "$N8N_DEPLOY_API_KEY" = "${KEY}" ] || { echo "키가 환경 변수로 오지 않음" >&2; exit 9; }
    [[ " $FAKE_APPLY_FAIL_TAGS " == *" $tag "* ]] && { echo "회의 녹취: 반영 뒤 확인 실패" >&2; exit 1; }
    echo "회의 녹취: 변경 없음" ;;
esac`,
  flock: '#!/bin/bash\n[ -z "$FAKE_LOCKED" ]',
};

function setup({ env = `DISCORD_TOKEN=t\nN8N_DEPLOY_API_KEY=${KEY}\nN8N_ENCRYPTION_KEY=e\n` } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mb-deploy-test-'));
  const bin = path.join(dir, 'bin');
  const app = path.join(dir, 'app');
  mkdirSync(bin);
  mkdirSync(path.join(app, 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(path.join(bin, name), `${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(path.join(app, '.env'), env, { mode: 0o600 });
  return { dir, app, log: path.join(dir, 'calls.log') };
}

function run(request, fake = {}, options) {
  const t = setup(options);
  const result = spawnSync('bash', [ENTRY], {
    encoding: 'utf8',
    env: {
      PATH: `${path.join(t.dir, 'bin')}:${process.env.PATH}`,
      HOME: t.dir,
      SSH_ORIGINAL_COMMAND: request,
      MEETING_BOT_DIR: t.app,
      DEPLOY_WAIT_SECONDS: '0',
      FAKE_LOG: t.log,
      REAL_DEPLOY_SH: DEPLOY,
      FAKE_TAGS: 'v1.0.0 v1.1.0',
      ...fake,
    },
  });
  const calls = (() => { try { return readFileSync(t.log, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } })();
  const env = readFileSync(path.join(t.app, '.env'), 'utf8');
  const mode = statSync(path.join(t.app, '.env')).mode & 0o777;
  rmSync(t.dir, { recursive: true, force: true });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, calls, env, mode };
}
const withTag = (tag) => `DISCORD_TOKEN=t\nN8N_DEPLOY_API_KEY=${KEY}\nN8N_ENCRYPTION_KEY=e\nRECORDER_TAG=${tag}\n`;
const checkouts = (calls) => calls.filter((c) => c.startsWith('git checkout')).map((c) => c.split('refs/tags/')[1]);
const applies = (calls) => calls.filter((c) => c.startsWith('docker compose run')).length;

// 'deploy vX.Y.Z'만 받는다. 그 밖의 요청은 git·docker를 부르기 전에 거부한다.
for (const request of ['', 'ls', 'deploy', 'deploy v1.0', 'deploy 1.0.0', 'deploy v1.0.0 extra', 'deploy v1.0.0; rm -rf /', 'deploy v1.0.0\nid', 'deploy $(id)', ' deploy v1.0.0', 'deploy v1.0.0-rc1']) {
  const r = run(request);
  assert.equal(r.code, 64, JSON.stringify(request));
  assert.deepEqual(r.calls, [], `${JSON.stringify(request)}: 아무것도 부르지 않는다`);
  assert.match(r.out, /허용하지 않는 요청/);
}

// 다른 배포가 진행 중이면 기다리지 않고 끝낸다.
{
  const r = run('deploy v1.1.0', { FAKE_LOCKED: '1' });
  assert.equal(r.code, 75);
  assert.deepEqual(r.calls, []);
}

// 저장소에 없는 태그는 받아 온 뒤 거부한다.
{
  const r = run('deploy v9.9.9');
  assert.equal(r.code, 65);
  assert.ok(r.calls.every((c) => c.startsWith('git fetch') || c.startsWith('git rev-parse')));
}

// 배포용 n8n API 키가 없으면 아무것도 바꾸지 않는다.
{
  const r = run('deploy v1.1.0', {}, { env: 'DISCORD_TOKEN=t\nRECORDER_TAG=v1.0.0\n' });
  assert.equal(r.code, 1);
  assert.match(r.out, /N8N_DEPLOY_API_KEY가 없어/);
  assert.deepEqual(checkouts(r.calls), []);
}

// 회의 중이면 체크아웃 전에 미룬다(.env도 그대로).
{
  const r = run('deploy v1.1.0', { FAKE_MEETINGS: '1' }, { env: withTag('v1.0.0') });
  assert.equal(r.code, 75);
  assert.match(r.out, /회의 중\(진행 중인 녹음 1개\)이라 배포를 미룹니다/);
  assert.deepEqual(checkouts(r.calls), []);
  assert.equal(r.env, withTag('v1.0.0'));
}

// 첫 배포: 체크아웃 → .env의 RECORDER_TAG 갱신 → 이미지 받기 → 녹음 봇만 교체 → 준비 완료 확인 → 워크플로 반영.
{
  const r = run('deploy v1.1.0');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /v1\.1\.0 배포 완료/);
  assert.equal(r.env, `DISCORD_TOKEN=t\nN8N_DEPLOY_API_KEY=${KEY}\nN8N_ENCRYPTION_KEY=e\nRECORDER_TAG=v1.1.0\n`, '다른 값은 그대로 두고 태그만 적는다');
  assert.equal(r.mode, 0o600, '.env 권한을 지킨다');
  const order = ['git fetch', 'git rev-parse', 'git show', 'docker compose exec', 'git checkout', 'docker compose pull --quiet recorder',
    'docker compose up -d --no-build recorder', 'docker compose ps', 'docker compose logs', 'docker compose run'];
  let at = -1;
  for (const prefix of order) {
    const next = r.calls.findIndex((c, i) => i > at && c.startsWith(prefix));
    assert.ok(next > at, `${prefix} 순서`);
    at = next;
  }
  assert.ok(r.calls.every((c) => !c.includes(KEY)), '키 값이 명령 인자에 보이지 않는다');
  assert.ok(r.calls.every((c) => !/compose (up|pull|run).*\bn8n\b(?!:)/.test(c.replace('scripts/deploy', ''))), 'n8n 컨테이너는 다시 만들지 않는다');
  assert.match(r.calls.find((c) => c.startsWith('docker compose run')), /--rm --no-deps -T -e N8N_DEPLOY_API_KEY -v .*\/workflows:\/app\/workflows:ro recorder node scripts\/deploy\/apply-workflows\.js$/);
}

// 워크플로 반영이 실패하면 이전 태그로 되돌린다.
{
  const r = run('deploy v1.1.0', { FAKE_APPLY_FAIL_TAGS: 'v1.1.0' }, { env: withTag('v1.0.0') });
  assert.equal(r.code, 1);
  assert.match(r.out, /v1\.1\.0: 워크플로 반영 실패/);
  assert.match(r.out, /v1\.0\.0로 되돌렸습니다/);
  assert.deepEqual(checkouts(r.calls), ['v1.1.0', 'v1.0.0']);
  assert.equal(applies(r.calls), 2);
  assert.match(r.env, /RECORDER_TAG=v1\.0\.0\n$/);
}

// 녹음 봇이 준비 완료되지 않으면 워크플로를 건드리지 않고 되돌린다.
{
  const r = run('deploy v1.1.0', { FAKE_NOT_READY_TAG: 'v1.1.0' }, { env: withTag('v1.0.0') });
  assert.equal(r.code, 1);
  assert.match(r.out, /v1\.1\.0: 녹음 봇이 준비 완료되지 않았습니다/);
  assert.deepEqual(checkouts(r.calls), ['v1.1.0', 'v1.0.0']);
  assert.equal(applies(r.calls), 1, '되돌린 태그에서만 워크플로를 반영한다');
}

// 이전 태그가 없거나(첫 배포) 같은 태그면 되돌리지 않고 2로 끝낸다.
for (const env of [undefined, withTag('v1.1.0')]) {
  const r = run('deploy v1.1.0', { FAKE_APPLY_FAIL_TAGS: 'v1.1.0' }, env && { env });
  assert.equal(r.code, 2);
  assert.match(r.out, /되돌릴 이전 태그가 없습니다/);
  assert.deepEqual(checkouts(r.calls), ['v1.1.0']);
}

// 되돌리기마저 실패하면 2로 끝내고 서버에서 확인하라고 알린다.
{
  const r = run('deploy v1.1.0', { FAKE_APPLY_FAIL_TAGS: 'v1.1.0 v1.0.0' }, { env: withTag('v1.0.0') });
  assert.equal(r.code, 2);
  assert.match(r.out, /v1\.0\.0로 되돌리기도 실패했습니다/);
}

console.log('배포 셸 스크립트 오프라인 테스트 통과');
