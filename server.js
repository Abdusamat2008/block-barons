'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, BOARD, GROUP_COLORS } = require('./game');

const PORT = process.env.PORT || 3000;
const TURN_MS = +process.env.TURN_MS || 45000; // время на ход человека
const BOT_MS = +process.env.BOT_MS || 900; // пауза между действиями бота
const PUB = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const PROFILES_FILE = path.join(DATA, 'profiles.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

// ---------- профили ----------
let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); } catch (_) { profiles = {}; }
let saveTimer = null;
function saveProfiles() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles)); } catch (e) { console.error('save failed', e.message); }
  }, 300);
}
function getProfile(token, name) {
  if (!profiles[token]) profiles[token] = { name: name || 'Игрок', tutorialDone: false, practiceGames: 0, liveGames: 0, wins: 0 };
  if (name) profiles[token].name = name.slice(0, 16);
  return profiles[token];
}
const canLive = (p) => p.tutorialDone && p.practiceGames >= 1;

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.join(PUB, url);
  if (!path.resolve(file).startsWith(PUB)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// ---------- состояние ----------
const wss = new WebSocketServer({ server });
const conns = new Map(); // token -> ws
const lobbies = new Map();
let lobbySeq = 1;

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function sendTo(token, obj) { send(conns.get(token), obj); }
function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while ([...lobbies.values()].some((l) => l.code === c));
  return c;
}
function lobbyOf(token) { return [...lobbies.values()].find((l) => l.members.includes(token)); }
function lobbyPublic(l, forMember) {
  return {
    id: l.id, name: l.name, mode: l.mode, private: l.private, max: l.max, rounds: l.rounds, startCash: l.startCash,
    fillBots: l.fillBots, state: l.state, host: l.host,
    code: forMember || !l.private ? l.code : undefined,
    players: l.members.map((t) => ({ id: t, name: profiles[t]?.name || '?', host: t === l.host })),
  };
}
function listOpen() {
  return [...lobbies.values()].filter((l) => l.mode === 'live' && !l.private && l.state === 'waiting').map((l) => lobbyPublic(l, false));
}
function broadcastList() {
  const list = listOpen();
  for (const [t, ws] of conns) if (!lobbyOf(t)) send(ws, { t: 'lobbies', list });
}
function pushLobby(l) { for (const t of l.members) sendTo(t, { t: 'lobby', lobby: lobbyPublic(l, true) }); }
function pushGame(l) {
  if (!l.game) return;
  const view = l.game.view();
  const msg = { t: 'game', deadline: l.deadline, now: Date.now(), view };
  for (const t of l.members) sendTo(t, msg);
}
function destroyLobby(l) { clearTimeout(l.timer); lobbies.delete(l.id); broadcastList(); }

function leaveLobby(token) {
  const l = lobbyOf(token);
  if (!l) return;
  l.members = l.members.filter((t) => t !== token);
  sendTo(token, { t: 'left' });
  if (l.state === 'playing' && l.game) {
    const p = l.game.player(token);
    if (p && !p.isBot) { p.isBot = true; p.name = p.name + ' (бот)'; }
  }
  if (!l.members.length) return destroyLobby(l);
  if (l.host === token) l.host = l.members[0];
  if (l.state === 'waiting') pushLobby(l);
  else { pushGame(l); schedule(l); }
  broadcastList();
}

// ---------- игровой цикл ----------
function startGame(l) {
  const players = l.members.map((t) => ({ id: t, name: profiles[t].name }));
  const names = ['Альфа', 'Бета', 'Гамма', 'Дельта', 'Омега', 'Сигма'];
  const need = l.mode === 'bots' || l.fillBots ? l.max - players.length : 0;
  for (let i = 0; i < need; i++) players.push({ id: 'bot' + l.id + '_' + i, name: 'Бот ' + names[i % 6], isBot: true });
  l.game = new Game({ players, turnLimit: l.rounds, startCash: l.startCash });
  l.state = 'playing';
  l.key = '';
  pushLobby(l);
  pushGame(l);
  schedule(l);
  broadcastList();
}

function isOnlineHuman(l, p) { return !p.isBot && conns.has(p.id) && l.members.includes(p.id); }

function schedule(l) {
  clearTimeout(l.timer);
  const g = l.game;
  if (!g) return;
  // все живые люди разорились — партия окончена
  if (!g.finished && g.players.some((p) => p.human) && g.players.filter((p) => p.human).every((p) => p.bankrupt)) g.forceFinish();
  if (g.finished) return finishGame(l);
  const p = g.curPlayer();
  const human = isOnlineHuman(l, p);
  const key = `${g.cur}:${g.phase}:${g.seq}:${g.again}`;
  if (human) {
    if (l.key !== key || !l.deadline) l.deadline = Date.now() + TURN_MS;
  } else l.deadline = 0;
  l.key = key;
  const delay = human ? Math.max(500, l.deadline - Date.now()) : BOT_MS;
  l.timer = setTimeout(() => {
    if (l.game !== g || g.finished) return;
    if (human && isOnlineHuman(l, g.curPlayer()) && g.curPlayer().id === p.id) g.autoStep(); else g.botStep();
    pushGame(l);
    schedule(l);
  }, delay);
}

function finishGame(l) {
  if (l.state === 'done') return;
  const g = l.game;
  l.state = 'done'; l.deadline = 0;
  const st = g.standings();
  for (const t of l.members) {
    const pr = profiles[t]; if (!pr) continue;
    if (l.mode === 'bots') pr.practiceGames++; else pr.liveGames++;
    if (st[0] && st[0].id === t) pr.wins++;
    sendTo(t, { t: 'profile', profile: pr, canLive: canLive(pr) });
  }
  saveProfiles();
  pushGame(l);
  pushLobby(l);
  clearTimeout(l.timer);
  l.timer = setTimeout(() => { if (lobbies.has(l.id)) { l.members.slice().forEach((t) => sendTo(t, { t: 'closed' })); l.members = []; destroyLobby(l); } }, 10 * 60 * 1000);
}

// ---------- сообщения ----------
function clamp(n, a, b, d) { n = Math.trunc(Number(n)); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; }
const GATE = 'Сначала пройди обучение и сыграй одну партию с ботами';

function handle(ws, token, m) {
  const pr = profiles[token];
  switch (m.t) {
    case 'tutorialDone': pr.tutorialDone = true; saveProfiles(); send(ws, { t: 'profile', profile: pr, canLive: canLive(pr) }); break;
    case 'list': send(ws, { t: 'lobbies', list: listOpen() }); break;
    case 'practice': {
      if (lobbyOf(token)) return send(ws, { t: 'err', msg: 'Сначала выйди из текущей комнаты' });
      const l = { id: lobbySeq++, code: genCode(), name: 'Тренировка', mode: 'bots', private: true, max: clamp(m.bots, 1, 5, 3) + 1, rounds: clamp(m.rounds, 5, 40, 12), startCash: 1500, fillBots: true, state: 'waiting', host: token, members: [token], game: null, timer: null, deadline: 0 };
      lobbies.set(l.id, l); startGame(l); break;
    }
    case 'create': {
      if (!canLive(pr)) return send(ws, { t: 'err', msg: GATE });
      if (lobbyOf(token)) return send(ws, { t: 'err', msg: 'Сначала выйди из текущей комнаты' });
      const l = {
        id: lobbySeq++, code: genCode(), name: String(m.name || pr.name + ' — комната').slice(0, 24), mode: 'live', private: !!m.private,
        max: clamp(m.max, 2, 6, 4), rounds: clamp(m.rounds, 5, 60, 20), startCash: clamp(m.startCash, 500, 5000, 1500),
        fillBots: !!m.fillBots, state: 'waiting', host: token, members: [token], game: null, timer: null, deadline: 0,
      };
      lobbies.set(l.id, l); pushLobby(l); broadcastList(); break;
    }
    case 'join': {
      if (!canLive(pr)) return send(ws, { t: 'err', msg: GATE });
      if (lobbyOf(token)) return send(ws, { t: 'err', msg: 'Ты уже в комнате' });
      const l = m.code ? [...lobbies.values()].find((x) => x.mode === 'live' && x.code === String(m.code).toUpperCase().trim()) : lobbies.get(m.id);
      if (!l || l.mode !== 'live') return send(ws, { t: 'err', msg: 'Комната не найдена' });
      if (l.state !== 'waiting') return send(ws, { t: 'err', msg: 'Игра уже началась' });
      if (l.members.length >= l.max) return send(ws, { t: 'err', msg: 'Комната заполнена' });
      if (l.private && !m.code) return send(ws, { t: 'err', msg: 'Нужен код комнаты' });
      l.members.push(token); pushLobby(l); broadcastList(); break;
    }
    case 'leave': leaveLobby(token); break;
    case 'start': {
      const l = lobbyOf(token);
      if (!l || l.host !== token || l.state !== 'waiting') return;
      if (l.mode === 'live' && l.members.length < 2 && !l.fillBots) return send(ws, { t: 'err', msg: 'Нужно минимум 2 игрока (или включи ботов-заполнителей)' });
      startGame(l); break;
    }
    case 'act': {
      const l = lobbyOf(token);
      if (!l || !l.game || l.game.finished) return;
      const r = l.game.act(token, String(m.a), m.arg === undefined ? undefined : Number(m.arg));
      if (!r.ok) return send(ws, { t: 'err', msg: r.err });
      pushGame(l); schedule(l); break;
    }
    case 'chat': {
      const l = lobbyOf(token); if (!l) return;
      const text = String(m.text || '').slice(0, 140); if (!text) return;
      for (const t of l.members) sendTo(t, { t: 'chat', from: pr.name, text });
      break;
    }
  }
}

wss.on('connection', (ws) => {
  let token = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (m.t === 'hello') {
      token = String(m.token || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) || crypto.randomUUID();
      const old = conns.get(token); if (old && old !== ws) { try { old.close(); } catch (_) {} }
      conns.set(token, ws);
      const pr = getProfile(token, String(m.name || '').trim().slice(0, 16));
      saveProfiles();
      send(ws, { t: 'welcome', token, profile: pr, canLive: canLive(pr), board: BOARD, colors: GROUP_COLORS });
      const l = lobbyOf(token);
      if (l) { // переподключение
        if (l.game) { const p = l.game.player(token); if (p) { p.isBot = false; p.name = pr.name; } }
        send(ws, { t: 'lobby', lobby: lobbyPublic(l, true) });
        if (l.game) { pushGame(l); schedule(l); }
      } else send(ws, { t: 'lobbies', list: listOpen() });
      return;
    }
    if (!token) return;
    try { handle(ws, token, m); } catch (e) { console.error(e); send(ws, { t: 'err', msg: 'Ошибка сервера' }); }
  });
  ws.on('close', () => {
    if (!token || conns.get(token) !== ws) return;
    conns.delete(token);
    const l = lobbyOf(token);
    if (!l) return;
    if (l.state === 'waiting') { leaveLobby(token); return; }
    if (l.game) {
      const p = l.game.player(token);
      if (p && !p.isBot) { p.isBot = true; }
      schedule(l); // бот подхватит ход ушедшего
      if (p && l.game.curPlayer().id === p.id) pushGame(l);
    }
    if (!l.members.some((t) => conns.has(t))) setTimeout(() => { if (lobbies.has(l.id) && !l.members.some((t) => conns.has(t))) destroyLobby(l); }, 60000);
  });
});

server.listen(PORT, () => console.log('Block Barons: http://localhost:' + PORT));
module.exports = { server };
