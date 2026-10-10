// Discord 없이 연결 끊김, 채널 이동, 채널 삭제, 봇 재시작을 흉내 내 회의가 하나로 이어지는지 확인한다.
// 음성 연결은 @discordjs/voice의 상태 이름과 이벤트를 따르는 가짜 객체로 바꾸고, 발화는 ffmpeg로 만든
// Opus 패킷을 실제 AudioReceiveStream에 넣는다.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { AudioReceiveStream, VoiceConnectionStatus } from '@discordjs/voice';
import * as prism from 'prism-media';
import { finalizeRecording } from '../src/finalize.js';
import { MeetingRecorder } from '../src/recorder.js';
import { findUnfinished, readState, statePath } from '../src/state.js';

const run = promisify(execFile);
const TIMING = { graceMs: 100, readyTimeoutMs: 100, retryBaseMs: 20, retryMaxMs: 50, heartbeatMs: 60_000 };
const DISCONNECTED_4014 = { status: VoiceConnectionStatus.Disconnected, reason: 0, closeCode: 4014 };

const source = path.join(await mkdtemp(path.join(os.tmpdir(), 'meeting-reconnect-src-')), 'tone.ogg');
await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-frame_duration', '20', source]);
const packets = [];
for await (const packet of createReadStream(source).pipe(new prism.opus.OggDemuxer())) packets.push(packet);

/** VoiceConnection처럼 상태가 바뀌면 stateChange와 상태 이름 이벤트를 낸다. rejoin은 지정한 횟수만큼 실패한다. */
class FakeConnection extends EventEmitter {
  constructor(channelId, { failRejoins = 0 } = {}) {
    super();
    this.joinConfig = { channelId };
    this.failRejoins = failRejoins;
    this.rejoinCalls = 0;
    this.current = { status: VoiceConnectionStatus.Ready };
    const subscriptions = new Map();
    this.receiver = {
      subscriptions,
      speaking: new EventEmitter(),
      subscribe(userId, options) {
        const stream = new AudioReceiveStream(options);
        stream.once('close', () => subscriptions.delete(userId));
        subscriptions.set(userId, stream);
        return stream;
      },
    };
  }

  get state() {
    return this.current;
  }

  set state(next) {
    const old = this.current;
    this.current = next;
    this.emit('stateChange', old, next);
    this.emit(next.status, old, next);
  }

  rejoin() {
    this.rejoinCalls += 1;
    if (this.rejoinCalls > this.failRejoins) {
      setImmediate(() => {
        this.state = { status: VoiceConnectionStatus.Signalling };
        this.state = { status: VoiceConnectionStatus.Ready };
      });
    }
    return true;
  }

  destroy() {
    this.state = { status: VoiceConnectionStatus.Destroyed };
  }
}

function fakeGuild({ deleted = new Set() } = {}) {
  return {
    id: 'g1',
    voiceAdapterCreator: null,
    members: { fetch: async (id) => ({ displayName: `화자${id}`, user: { bot: false } }) },
    channels: {
      cache: new Map([['v2', { id: 'v2', name: '회의실2' }]]),
      async fetch(id) {
        if (deleted.has(id)) throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
        return { id, name: id };
      },
    },
  };
}

async function newRecorder({ connection, guild = fakeGuild(), recordingsDir, state }) {
  const options = {
    guild,
    voiceChannel: state?.voiceChannel ?? { id: 'v1', name: '회의실' },
    textChannel: { id: 't1' },
    recordingsDir: recordingsDir ?? (await mkdtemp(path.join(os.tmpdir(), 'meeting-reconnect-'))),
    join: () => connection,
    timing: TIMING,
  };
  const recorder = state ? await MeetingRecorder.resume({ ...options, state }) : new MeetingRecorder(options);
  recorder.notices = [];
  recorder.on('notice', (text) => recorder.notices.push(text));
  return recorder;
}

async function speak(recorder, connection, userId, count, { silence = true } = {}) {
  recorder.onSpeakingStart(userId);
  for (const packet of packets.slice(0, count)) {
    connection.receiver.subscriptions.get(userId)?.push(packet);
    await sleep(20);
  }
  if (silence) await sleep(1_300);
}

async function until(label, check, timeoutMs = 3_000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`${label}을(를) 기다리다 시간이 지났습니다`);
    await sleep(10);
  }
}

const exists = (file) => stat(file).then(() => true, () => false);

// 1. 사람이 봇 연결을 끊음(4014): rejoin 두 번 실패 뒤 세 번째에 다시 붙는다.
{
  const connection = new FakeConnection('v1', { failRejoins: 2 });
  const recorder = await newRecorder({ connection });
  await recorder.start();
  await speak(recorder, connection, 'A', 50);
  connection.state = DISCONNECTED_4014;
  await until('재접속', () => connection.state.status === VoiceConnectionStatus.Ready && !recorder.openGap);
  await speak(recorder, connection, 'B', 50);
  const { manifest } = await finalizeRecording(await recorder.stop(), { minSegmentMs: 700 });

  assert.equal(connection.rejoinCalls, 3, 'rejoin 횟수');
  assert.equal(manifest.segments.length, 2, '끊기기 전과 후의 발화가 같은 회의에 있다');
  assert.equal(manifest.gaps.length, 1);
  assert.equal(manifest.gaps[0].reason, '음성 연결 끊김');
  assert.ok(manifest.gaps[0].endMs > manifest.gaps[0].startMs);
  assert.equal(recorder.notices.length, 2, '끊길 때와 다시 붙을 때 한 번씩 알린다');
  assert.ok(!(await exists(statePath(recorder.dir))), 'manifest를 쓰면 상태 파일을 지운다');
  console.log('1. 연결 끊김 뒤 재접속: 통과');
}

// 2. 다른 채널로 옮겨짐: 라이브러리가 스스로 다시 붙으므로 끊김 알림 없이 옮긴 채널에서 이어 간다.
{
  const connection = new FakeConnection('v1');
  const recorder = await newRecorder({ connection });
  await recorder.start();
  await speak(recorder, connection, 'A', 50);
  connection.state = DISCONNECTED_4014;
  connection.joinConfig.channelId = 'v2';
  connection.state = { status: VoiceConnectionStatus.Signalling };
  connection.state = { status: VoiceConnectionStatus.Ready };
  await speak(recorder, connection, 'B', 50);
  const { manifest } = await finalizeRecording(await recorder.stop(), { minSegmentMs: 700 });

  assert.equal(connection.rejoinCalls, 0);
  assert.equal(manifest.voiceChannel.id, 'v2');
  assert.equal(manifest.segments.length, 2);
  assert.equal(recorder.notices.length, 1, '채널을 옮겼다는 알림만 보낸다');
  assert.match(recorder.notices[0], /회의실2/);
  console.log('2. 채널 이동: 통과');
}

// 3. 음성 채널 삭제: 재접속하지 않고 마무리를 요청한다.
{
  const connection = new FakeConnection('v1', { failRejoins: Infinity });
  const recorder = await newRecorder({ connection, guild: fakeGuild({ deleted: new Set(['v1']) }) });
  await recorder.start();
  await speak(recorder, connection, 'A', 50);
  const deleted = new Promise((resolve) => recorder.once('channelDeleted', resolve));
  connection.state = DISCONNECTED_4014;
  await deleted;
  const { manifest } = await finalizeRecording(await recorder.stop(), { minSegmentMs: 700 });

  assert.equal(connection.rejoinCalls, 0);
  assert.equal(manifest.segments.length, 1);
  assert.equal(manifest.gaps.length, 1, '삭제 뒤 종료까지를 끊긴 구간으로 남긴다');
  console.log('3. 채널 삭제: 통과');
}

// 4. 봇 재시작: 말하는 도중 프로세스가 죽은 것처럼 멈춘 뒤, 상태 파일로 같은 회의를 이어 간다.
{
  const recordingsDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-restart-'));
  const before = new FakeConnection('v1');
  const crashed = await newRecorder({ connection: before, recordingsDir });
  await crashed.start();
  await speak(crashed, before, 'A', 50);
  await speak(crashed, before, 'B', 60, { silence: false });
  // 프로세스가 죽으면 상태 파일을 더 쓰지 못하고 쓰던 발화 파일은 끝 표시 없이 남는다.
  crashed.saveState = () => Promise.resolve();
  clearInterval(crashed.heartbeat);
  before.receiver.subscriptions.get('B').destroy();
  await sleep(200);

  const unfinished = await findUnfinished(recordingsDir);
  assert.deepEqual(unfinished, [crashed.dir]);
  const state = await readState(crashed.dir);
  assert.equal(state.segments.length, 1, '상태 파일에는 끝난 발화만 있다');

  const after = new FakeConnection('v1');
  const resumed = await newRecorder({ connection: after, recordingsDir, state });
  assert.equal(resumed.recoveredCount, 1, '쓰던 발화 파일을 살린다');
  await resumed.start();
  await speak(resumed, after, 'A', 50);
  const { manifest } = await finalizeRecording(await resumed.stop(), { minSegmentMs: 700 });

  assert.equal(manifest.meetingId, crashed.meetingId);
  assert.equal(manifest.startedAt, crashed.startedAt.toISOString());
  assert.deepEqual(manifest.segments.map((s) => s.userId), ['A', 'B', 'A'], '재시작 전후 발화가 한 회의에 있다');
  // 발화는 패킷 10개(0.2초)씩 페이지로 묶여 파일에 쓰이므로, 죽는 순간 아직 쓰지 못한 마지막 페이지만큼 빠질 수 있다.
  const recovered = manifest.segments[1];
  const recoveredMs = recovered.endMs - recovered.startMs;
  assert.ok(recoveredMs >= 950 && recoveredMs <= 1_250, `살린 발화 길이 ${recoveredMs}ms (말한 길이 1200ms)`);
  assert.equal(manifest.gaps.length, 1);
  assert.equal(manifest.gaps[0].reason, '봇 재시작');
  assert.deepEqual(await findUnfinished(recordingsDir), [], '마무리하면 이어 갈 회의가 없다');
  console.log('4. 봇 재시작 뒤 이어 가기: 통과');
}

console.log('재접속 오프라인 테스트 통과');
