import process from 'node:process';
import { REST, Routes } from 'discord.js';
import { meetingCommand } from './commands.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

// 서버 단위로 등록하면 바로 반영된다.
const rest = new REST().setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), {
  body: [meetingCommand.toJSON()],
});
console.log('/회의녹음 명령을 등록했습니다.');
