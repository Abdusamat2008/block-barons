'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, botDecide, COINS, CARDS } = require('./game');

const PORT = process.env.PORT || 3000;
const PLAN_MS = +process.env.PLAN_MS || 30000;
const RESULT_MS = +process.env.RESULT_MS || 6000;
const PUB = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three', 'build');
const DATA = path.join(__dirname, 'data');
const PROFILES_FILE = path.join(DATA, 'profiles.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

// ---------- профили (сохраняются в файл) ----------
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
  let file;
  if (url.startsWith('/three/')) file = path.join(THREE_DIR, url.slice(7));
  else file = path.join(PUB, url);
  const base = url.startsWith('/three/') ? THREE_DIR : PUB;
  if (!path.resolve(file).startsWith(base)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// ---------- состояние ----------
const wss = new WebSocketServer({ server });
const conns = new Map(); // token -> ws
const lobbies = new Map(); // id -> lobby
let lobbySeq = 1;

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function sendTo(token, obj) { send(conns.get(token), obj); }
function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while ([...lobbies.values()].some((l) => l.code === c));
  return c;
}

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
function lobbyOf(token) { return [...lobbies.values()].find((l) => l.members.includes(token)); }
function pushLobby(l) {
  for (const t of l.members) sendTo(t, { t: 'lobby', lobby: lobbyPublic(l, true) });
}
function pushGame(l) {
  const g = l.game; if (!g) return;
  for (const t of l.members) {
    sendTo(t, { t: 'game', phase: l.phase, deadline: l.deadline, now: Date.now(), view: g.view(t) });
  }
}

function destroyLobby(l) {
  clearTimeout(l.timer);
  lobbies.delete(l.id);
  broadcastList();
}

function leaveLobby(token) {
  const l = lobbyOf(token);
  if (!l) return;
  l.members = l.members.filter((t) => t !== token);
  sendTo(token, { t: 'left' });
  if (l.state === 'playing' && l.game) {
    const p = l.game.player(token);
    if (p) { p.isBot = true; p.name = p.name + ' (бот)'; }
  }
  const humansLeft = l.members.length;
  if (!humansLeft) return destroyLobby(l);
  if (l.host === token) l.host = l.members[0];
  if (l.state === 'waiting') pushLobby(l);
  else { checkAdvance(l); pushGame(l); }
  broadcastList();
}

// ---------- игровой цикл ----------
function startGame(l) {
  const players = l.members.map((t) => ({ id: t, name: profiles[t].name }));
  let botN = 0;
  const need = l.mode === 'bots' ? l.max - players.length : l.fillBots ? l.max - players.length : 0;
  for (let i = 0; i < need; i++) { botN++; players.push({ id: 'bot' + l.id + '_' + botN, name: 'Бот ' + ['Альфа', 'Бета', 'Гамма', 'Дельта', 'Омега', 'Сигма'][i % 6], isBot: true }); }
  l.game = new Game({ players, rounds: l.rounds, startCash: l.startCash });
  l.state = 'playing';
  startPlan(l);
  pushLobby(l);
  broadcastList();
}

function humansAllSubmitted(l) {
  return l.game.players.filter((p) => !p.isBot).every((p) => p.submitted);
}

function startPlan(l) {
  const g = l.game;
  l.phase = 'plan';
  l.deadline = Date.now() + PLAN_MS;
  // боты решают сразу
  for (const p of g.players) if (p.isBot) { const d = botDecide(g, p); g.submit(p.id, d.orders, d.card); }
  pushGame(l);
  clearTimeout(l.timer);
  l.timer = setTimeout(() => resolveRound(l), PLAN_MS);
}

function checkAdvance(l) {
  if (l.phase === 'plan' && l.game && humansAllSubmitted(l)) { clearTimeout(l.timer); l.timer = setTimeout(() => resolveRound(l), 600); }
}

function resolveRound(l) {
  const g = l.game; if (!g || l.phase !== 'plan') return;
  // боты, подменившие ушедших, тоже ходят
  for (const p of g.players) if (p.isBot && !p.submitted) { const d = botDecide(g, p); g.submit(p.id, d.orders, d.card); }
  g.resolve();
  if (g.finished) return finishGame(l);
  l.phase = 'result';
  l.deadline = Date.now() + RESULT_MS;
  pushGame(l);
  clearTimeout(l.timer);
  l.timer = setTimeout(() => startPlan(l), RESULT_MS);
}

function finishGame(l) {
  const g = l.game;
  l.phase = 'done'; l.state = 'done'; l.deadline = 0;
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

function handle(ws, token, m) {
  const pr = profiles[token];
  switch (m.t) {
    case 'tutorialDone': pr.tutorialDone = true; saveProfiles(); send(ws, { t: 'profile', profile: pr, canLive: canLive(pr) }); break;
    case 'rename': getProfile(token, String(m.name || '').trim() || pr.name); saveProfiles(); send(ws, { t: 'profile', profile: pr, canLive: canLive(pr) }); break;
    case 'list': send(ws, { t: 'lobbies', list: listOpen() }); break;
    case 'practice': {
      if (lobbyOf(token)) return send(ws, { t: 'err', msg: 'Сначала выйди из текущей комнаты' });
      const l = { id: lobbySeq++, code: genCode(), name: 'Практика', mode: 'bots', private: true, max: clamp(m.bots, 1, 5, 3) + 1, rounds: clamp(m.rounds, 5, 15, 8), startCash: 1000, fillBots: true, state: 'waiting', host: token, members: [token], game: null, timer: null };
      lobbies.set(l.id, l); startGame(l); break;
    }
    case 'create': {
      if (!canLive(pr)) return send(ws, { t: 'err', msg: 'Сначала пройди обучение и сыграй одну партию с ботами' });
      if (lobbyOf(token)) return send(ws, { t: 'err', msg: 'Сначала выйди из текущей комнаты' });
      const l = {
        id: lobbySeq++, code: genCode(), name: String(m.name || pr.name + ' — комната').slice(0, 24), mode: 'live', private: !!m.private,
        max: clamp(m.max, 2, 6, 4), rounds: clamp(m.rounds, 5, 15, 10), startCash: clamp(m.startCash, 500, 5000, 1000),
        fillBots: !!m.fillBots, state: 'waiting', host: token, members: [token], game: null, timer: null,
      };
      lobbies.set(l.id, l); pushLobby(l); broadcastList(); break;
    }
    case 'join': {
      if (!canLive(pr)) return send(ws, { t: 'err', msg: 'Сначала пройди обучение и сыграй одну партию с ботами' });
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
    case 'submit': {
      const l = lobbyOf(token);
      if (!l || !l.game || l.phase !== 'plan') return;
      l.game.submit(token, m.orders, m.card);
      pushGame(l); checkAdvance(l); break;
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
      send(ws, { t: 'welcome', token, profile: pr, canLive: canLive(pr), coins: COINS, cards: CARDS });
      const l = lobbyOf(token);
      if (l) { // переподключение
        if (l.game) { const p = l.game.player(token); if (p) { p.isBot = false; p.name = pr.name; } }
        send(ws, { t: 'lobby', lobby: lobbyPublic(l, true) });
        if (l.game) pushGame(l);
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
    // в игре: временно ботом, можно вернуться
    if (l.game) {
      const p = l.game.player(token);
      if (p && !p.isBot) { p.isBot = true; }
      if (l.phase === 'plan') { checkAdvance(l); }
    }
    const anyOnline = l.members.some((t) => conns.has(t));
    if (!anyOnline) setTimeout(() => { if (lobbies.has(l.id) && !l.members.some((t) => conns.has(t))) destroyLobby(l); }, 60000);
  });
});

server.listen(PORT, () => console.log('Block Barons: http://localhost:' + PORT));
module.exports = { server };
