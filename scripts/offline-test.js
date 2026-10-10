// Discord 없이 녹음 → 정리 경로를 확인한다.
// ffmpeg로 만든 Opus 패킷을 실제 AudioReceiveStream에 20ms 간격으로 넣고,
// 화자 A는 무음으로 끝나게, 화자 B는 말하는 도중에 stop()을 불러 강제 종료한다.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AudioReceiveStream, VoiceConnectionStatus } from '@discordjs/voice';
import * as prism from 'prism-media';
import { finalizeRecording } from '../src/finalize.js';
import { MeetingRecorder } from '../src/recorder.js';

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = await mkdtemp(path.join(os.tmpdir(), 'meeting-recorder-test-'));
const source = path.join(work, 'tone.ogg');
await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-frame_duration', '20', source]);

const packets = [];
for await (const packet of createReadStream(source).pipe(new prism.opus.OggDemuxer())) packets.push(packet);

const subscriptions = new Map();
const connection = {
  state: { status: VoiceConnectionStatus.Ready },
  destroy() { this.state = { status: VoiceConnectionStatus.Destroyed }; },
  receiver: {
    subscriptions,
    subscribe(userId, options) {
      const stream = new AudioReceiveStream(options);
      stream.once('close', () => subscriptions.delete(userId));
      subscriptions.set(userId, stream);
      return stream;
    },
  },
};
const guild = {
  id: 'g1',
  members: { fetch: async (id) => ({ displayName: id === 'A' ? '화자A' : '화자B', user: { bot: false } }) },
};

const recorder = new MeetingRecorder({ guild, voiceChannel: { id: 'v1', name: '회의실' }, textChannel: { id: 't1' }, recordingsDir: work });
await mkdir(recorder.segmentsDir, { recursive: true });
recorder.connection = connection;

async function speak(userId, count) {
  recorder.onSpeakingStart(userId);
  for (const packet of packets.slice(0, count)) {
    subscriptions.get(userId)?.push(packet);
    await sleep(20);
  }
}

await speak('A', 50); // 약 1초 말하고 무음
await sleep(1_300);
await speak('B', 100); // 약 2초 말하는 도중 종료
const result = await recorder.stop();
const { manifest, dropped } = await finalizeRecording(result, { minSegmentMs: 700 });

console.log(JSON.stringify({ segments: manifest.segments, participants: manifest.participants, dropped }, null, 2));
for (const s of manifest.segments) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,channels', '-of', 'csv=p=0', path.join(recorder.segmentsDir, s.file)]);
  console.log(s.file, stdout.trim().replace(/\n/g, ' | '));
}
console.log('manifest.json 있음:', (await readFile(path.join(recorder.dir, 'manifest.json'), 'utf8')).length > 0);
console.log('작업 폴더:', work);
