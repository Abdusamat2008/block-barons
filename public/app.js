'use strict';
const $ = (id) => document.getElementById(id);
const fmt = (n) => '$' + Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PCOL = ['#ff5d73', '#3ee6c4', '#f7b32b', '#a56bff', '#38bdf8', '#fb923c'];
const FACES = ['⚀', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

let token = localStorage.getItem('bb_token') || '';
let name = localStorage.getItem('bb_name') || '';
let profile = null, canLive = false, BOARD = [], ws = null;
let lobby = null, V = null, deadline = 0, offset = 0;
let cells = [], shown = {}, walking = {}, lastSeq = -1, selSq = null;

// ---------------- сеть ----------------
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token, name }));
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = () => { toast('Соединение потеряно, переподключаюсь…'); setTimeout(connect, 1500); };
}
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
const act = (a, arg) => send({ t: 'act', a, arg });

function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 3200); }
function show(id) { document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active')); $(id).classList.add('active'); if (id === 'scr-game') requestAnimationFrame(resize); }

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      token = m.token; localStorage.setItem('bb_token', token);
      profile = m.profile; canLive = m.canLive; BOARD = m.board;
      buildBoard();
      if (!lobby && !V) afterLogin();
      break;
    case 'profile': profile = m.profile; canLive = m.canLive; updateMenu(); break;
    case 'lobbies': renderLobbies(m.list); break;
    case 'lobby': lobby = m.lobby; if (lobby.state === 'waiting') renderRoom(); break;
    case 'game': onGame(m); break;
    case 'left': case 'closed': lobby = null; V = null; selSq = null; shown = {}; lastSeq = -1; updateMenu(); show('scr-menu'); send({ t: 'list' }); break;
    case 'err': toast(m.msg); break;
  }
}

// ---------------- меню ----------------
function afterLogin() {
  updateMenu(); show('scr-menu');
  if (!profile.tutorialDone && !localStorage.getItem('bb_tut')) openTutorial(true);
}
function updateMenu() {
  if (!profile) return;
  $('whoami').textContent = `${profile.name} · тренировок: ${profile.practiceGames} · побед: ${profile.wins}`;
  $('lockIcon').textContent = canLive ? '🟢' : '🔒';
  $('btnLive').disabled = !canLive;
  $('lockNote').textContent = canLive ? '' : (!profile.tutorialDone ? 'Пройди обучение, чтобы открыть живые игры' : 'Доиграй 1 партию с ботами — откроются живые игроки');
}
$('btnEnter').onclick = () => {
  const v = $('nameInput').value.trim();
  if (!v) return toast('Введи ник');
  name = v; localStorage.setItem('bb_name', name); connect();
};
$('nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('btnEnter').click());
if (name) { $('nameInput').value = name; connect(); }

$('btnPractice').onclick = () => send({ t: 'practice', bots: 3, rounds: 12 });
$('btnLive').onclick = () => { show('scr-lobbies'); send({ t: 'list' }); };
$('btnBackMenu').onclick = () => show('scr-menu');
$('btnHow').onclick = () => openTutorial(false);
$('btnNewLobby').onclick = () => show('scr-create');
$('btnCreateBack').onclick = () => show('scr-lobbies');
$('btnCreate').onclick = () => send({
  t: 'create', name: $('cName').value.trim() || undefined, private: $('cPrivate').value === '1',
  max: +$('cMax').value, rounds: +$('cRounds').value, startCash: +$('cCash').value, fillBots: $('cBots').checked,
});
$('btnJoinCode').onclick = () => { const c = $('codeInput').value.trim(); if (c.length === 4) send({ t: 'join', code: c }); else toast('Код из 4 символов'); };
$('btnLeaveRoom').onclick = () => send({ t: 'leave' });
$('btnStart').onclick = () => send({ t: 'start' });
$('btnQuit').onclick = () => { if (confirm('Выйти из игры? Тебя заменит бот.')) send({ t: 'leave' }); };
$('btnEndMenu').onclick = () => send({ t: 'leave' });

function renderLobbies(list) {
  const el = $('lobbyList'); el.innerHTML = '';
  if (!list.length) el.innerHTML = '<div class="muted">Открытых лобби пока нет — создай своё!</div>';
  for (const l of list) {
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = `<div><b></b><div class="muted">${l.players.length}/${l.max} · ${l.rounds} кругов · ${fmt(l.startCash)}${l.fillBots ? ' · боты' : ''}</div></div>`;
    d.querySelector('b').textContent = l.name;
    const b = document.createElement('button'); b.className = 'btn small primary'; b.textContent = 'Войти';
    b.onclick = () => send({ t: 'join', id: l.id }); d.appendChild(b); el.appendChild(d);
  }
}
function renderRoom() {
  show('scr-room');
  $('roomTitle').textContent = lobby.name;
  $('roomInfo').textContent = `${lobby.private ? 'Закрытое' : 'Открытое'} · ${lobby.players.length}/${lobby.max} · ${lobby.rounds} кругов · ${fmt(lobby.startCash)}`;
  $('roomCode').textContent = lobby.code ? 'КОД: ' + lobby.code : '';
  const el = $('roomPlayers'); el.innerHTML = '';
  for (const p of lobby.players) { const d = document.createElement('div'); d.className = 'item'; d.textContent = (p.host ? '👑 ' : '') + p.name; el.appendChild(d); }
  $('btnStart').style.display = lobby.host === token ? '' : 'none';
}

// ---------------- обучение ----------------
const STEPS = [
  ['Цель игры', 'Стань самым богатым бароном: скупай улицы, бери аренду и разоряй соперников. Игра заканчивается, когда остался один игрок или прошло заданное число кругов. Тогда побеждает тот, у кого больше капитала (деньги + улицы + дома).'],
  ['Твой ход', 'Брось два кубика, и фишка пройдёт по кругу столько клеток. Дубль — ходишь ещё раз, три дубля подряд — в Блокировку. Каждый раз, когда проходишь СТАРТ, получаешь $200.'],
  ['Покупка и аренда', 'Встал на свободную улицу — можно купить её или отказаться. Встал на чужую — платишь аренду владельцу. Если собрать все улицы одного цвета, аренда на них удваивается и можно строить.'],
  ['Строительство', 'В панели «Мои улицы» кнопка + строит дом (до 4 домов, затем отель). Строить нужно равномерно по всей цветовой группе. Чем больше домов, тем выше аренда, а кнопка − продаёт строение за половину цены.'],
  ['Особые клетки', 'Биржи и Майнинг-ферма имеют особую аренду. «Событие» и «Фонд» — случайные карточки. «Комиссия» и «Налог» — платёж в банк. «Холодный кошелёк» отдаёт накопленный банк. «Бан биржи» отправляет в Блокировку.'],
  ['Блокировка и банкротство', 'Из Блокировки выходят дублем, за $50 или картой выхода (иначе через 3 хода). Если не хватает денег на платёж, дома продаются автоматически, а если и этого мало — ты банкрот. Сыграй тренировку с ботами, после неё откроются живые игроки.'],
];
let tIdx = 0, tFirst = false;
function openTutorial(first) { tIdx = 0; tFirst = first; $('tutorial').classList.remove('hidden'); renderStep(); }
function renderStep() {
  const [t, x] = STEPS[tIdx];
  $('tStep').textContent = `Шаг ${tIdx + 1} из ${STEPS.length}`;
  $('tTitle').textContent = t; $('tText').textContent = x;
  $('tBack').style.visibility = tIdx ? 'visible' : 'hidden';
  $('tNext').textContent = tIdx === STEPS.length - 1 ? (tFirst ? 'Начать тренировку' : 'Понятно') : 'Дальше';
}
function closeTutorial(finished) {
  $('tutorial').classList.add('hidden');
  localStorage.setItem('bb_tut', '1');
  if (profile && !profile.tutorialDone && finished) send({ t: 'tutorialDone' });
  if (finished && tFirst) send({ t: 'practice', bots: 3, rounds: 12 });
}
$('tNext').onclick = () => { if (tIdx < STEPS.length - 1) { tIdx++; renderStep(); } else closeTutorial(true); };
$('tBack').onclick = () => { if (tIdx) { tIdx--; renderStep(); } };
$('tSkip').onclick = () => { $('tutorial').classList.add('hidden'); localStorage.setItem('bb_tut', '1'); if (profile && !profile.tutorialDone) send({ t: 'tutorialDone' }); };

// ---------------- поле ----------------
const ICONS = { start: '➜', jail: '🔒', park: '👛', gojail: '⛔', event: '❓', fund: '💼', tax: '💸', exch: '🏦' };
function gridPos(i) {
  if (i === 0) return [11, 11];
  if (i < 10) return [11, 11 - i];
  if (i === 10) return [11, 1];
  if (i < 20) return [11 - (i - 10), 1];
  if (i === 20) return [1, 1];
  if (i < 30) return [1, 1 + (i - 20)];
  if (i === 30) return [1, 11];
  return [1 + (i - 30), 11];
}
function buildBoard() {
  const b = $('board');
  [...b.children].forEach((c) => { if (c.id !== 'center') c.remove(); });
  cells = BOARD.map((s) => {
    const el = document.createElement('div');
    const [r, c] = gridPos(s.i);
    el.className = 'cell' + (['start', 'jail', 'park', 'gojail'].includes(s.type) ? ' corner' : '');
    el.style.gridRow = r; el.style.gridColumn = c;
    const icon = s.type === 'util' ? (s.name.includes('Майнинг') ? '⛏️' : '🖥️') : ICONS[s.type];
    el.innerHTML =
      (s.type === 'prop' ? `<div class="band" style="background:${s.color}"></div><div class="pips"></div>` : `<div class="ic">${icon || ''}</div>`) +
      `<div class="nm">${esc(s.name)}</div>` +
      (s.price ? `<div class="pr">${fmt(s.price)}</div>` : s.amount ? `<div class="pr">${fmt(s.amount)}</div>` : '') +
      '<div class="ownbar"></div><div class="tokens"></div>';
    el.onclick = () => { selSq = s.i; renderSqInfo(); };
    b.appendChild(el);
    return { el, pips: el.querySelector('.pips'), own: el.querySelector('.ownbar'), tokens: el.querySelector('.tokens') };
  });
  resize();
}
function resize() {
  const w = $('board').clientWidth;
  if (w) document.documentElement.style.setProperty('--u', w / 100 + 'px');
}
addEventListener('resize', resize);

// ---------------- игра ----------------
const me = () => V && V.players.find((p) => p.id === token);
const pById = (id) => V && V.players.find((p) => p.id === id);

function onGame(m) {
  const first = !V;
  V = m.view; deadline = m.deadline; offset = m.now - Date.now();
  if (V.finished) { renderBoardState(); return showEnd(); }
  show('scr-game');
  // анимация фишек
  for (const p of V.players) {
    if (shown[p.id] === undefined || first) { shown[p.id] = p.pos; continue; }
    if (shown[p.id] !== p.pos) {
      const steps = (p.pos - shown[p.id] + 40) % 40;
      if (p.anim === 'walk' && steps <= 12) walkTo(p.id);
      else if (!walking[p.id]) shown[p.id] = p.pos;
    }
  }
  // кубики
  if (V.seq !== lastSeq) {
    if (lastSeq !== -1 && V.seq > lastSeq) rollDice(); else setDice();
    lastSeq = V.seq;
  }
  renderAll();
}

function walkTo(id) {
  if (walking[id]) return;
  walking[id] = true;
  const tick = () => {
    const p = pById(id);
    if (!p) { walking[id] = false; return; }
    if (shown[id] === p.pos) { walking[id] = false; renderTokens(); renderActions(); return; }
    shown[id] = (shown[id] + 1) % 40; renderTokens(); setTimeout(tick, 120);
  };
  tick();
}
function setDice() { $('die1').textContent = FACES[V.dice[0]]; $('die2').textContent = FACES[V.dice[1]]; }
function rollDice() {
  for (const id of ['die1', 'die2']) { const d = $(id); d.classList.remove('roll'); void d.offsetWidth; d.classList.add('roll'); }
  setTimeout(setDice, 300);
}

function renderAll() { renderBoardState(); renderPanel(); renderActions(); renderStreets(); renderSqInfo(); renderCenter(); }

function renderBoardState() {
  V.owner.forEach((o, i) => {
    const c = cells[i]; if (!c) return;
    const pl = o && pById(o);
    c.own.style.background = pl ? PCOL[pl.color] : 'transparent';
    const l = V.lvl[i];
    if (c.pips) c.pips.textContent = l === 5 ? '🏨' : '🏠'.repeat(l);
  });
  renderTokens();
}
function renderTokens() {
  cells.forEach((c) => (c.tokens.innerHTML = ''));
  for (const p of V.players) {
    if (p.bankrupt) continue;
    const pos = shown[p.id] === undefined ? p.pos : shown[p.id];
    const t = document.createElement('div');
    t.className = 'tok' + (p.id === V.cur && !V.finished ? ' cur' : '');
    t.style.background = PCOL[p.color]; t.title = p.name;
    cells[pos].tokens.appendChild(t);
  }
}

function phaseText() {
  const p = pById(V.cur);
  if (!p) return '';
  const who = p.id === token ? 'Твой ход' : `Ходит ${p.name}`;
  if (V.phase === 'roll') return `${who}: бросок кубиков`;
  if (V.phase === 'buy') return `${who}: решает с покупкой`;
  return `${who}: завершает ход`;
}
function renderCenter() {
  $('turnInfo').textContent = phaseText();
  $('cardInfo').textContent = V.card ? `${V.card.kind === 'event' ? '❓' : '💼'} ${V.card.who}: ${V.card.text}` : '';
}

function renderPanel() {
  $('gRound').textContent = `Круг ${V.round}/${V.turnLimit}`;
  $('gPot').textContent = V.pot ? `· банк кошелька ${fmt(V.pot)}` : '';
  const props = (id) => V.owner.filter((o) => o === id).length;
  $('gPlayers').innerHTML = V.players.map((p) =>
    `<div class="pl ${p.id === V.cur ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}"><span class="dot" style="background:${PCOL[p.color]}"></span>` +
    `<span class="nmx">${esc(p.name)}${p.id === token ? ' (ты)' : ''}${p.jail ? ' 🔒' : ''}${p.jailCards ? ' 🎟'.repeat(p.jailCards) : ''}</span>` +
    `<span class="muted">${props(p.id)} ул.</span><b>${fmt(p.cash)}</b></div>`).join('');
  $('gLog').innerHTML = V.log.map((l) => `<div>${esc(l)}</div>`).join('');
}

function renderActions() {
  const box = $('actions'); box.innerHTML = '';
  const m = me();
  const btn = (txt, cls, fn, dis) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = txt; b.disabled = !!dis; b.onclick = fn; box.appendChild(b); };
  const hint = (t) => { const h = document.createElement('div'); h.className = 'hint'; h.textContent = t; box.appendChild(h); };
  if (!m || m.bankrupt) { hint(m && m.bankrupt ? 'Ты банкрот. Можешь наблюдать за игрой.' : ''); return; }
  if (V.cur !== token) { hint(`Ждём: ${pById(V.cur).name}`); return; }
  if (walking[token]) { hint('Фишка движется…'); return; }
  if (V.phase === 'roll') {
    if (m.jail > 0) {
      hint(`Ты в Блокировке (попыток осталось: ${m.jail}). Дубль освободит тебя бесплатно.`);
      btn(`Заплатить ${fmt(50)}`, '', () => act('payJail'), m.cash < 50);
      if (m.jailCards) btn('Карта выхода', '', () => act('useCard'));
    }
    btn('🎲 Бросить кубики', 'primary', () => act('roll'));
  } else if (V.phase === 'buy') {
    const s = BOARD[V.pending];
    hint(`Свободно: «${s.name}»`);
    btn(`Купить за ${fmt(s.price)}`, 'good', () => act('buy'), m.cash < s.price);
    btn('Отказаться', 'bad', () => act('decline'));
  } else if (V.phase === 'end') {
    btn(V.again ? '🎲 Бросить ещё раз (дубль)' : 'Завершить ход', 'primary', () => act('endTurn'));
  }
}

function renderStreets() {
  const box = $('myStreets'); const m = me();
  if (!m || m.bankrupt) { box.innerHTML = ''; return; }
  const mine = BOARD.filter((s) => V.owner[s.i] === token);
  if (!mine.length) { box.innerHTML = '<h3>Мои улицы</h3><div class="muted" style="font-size:13px">Пока ничего нет — покупай улицы на своём пути.</div>'; return; }
  const myTurn = V.cur === token && V.phase !== 'buy';
  box.innerHTML = '<h3>Мои улицы</h3>';
  for (const s of mine) {
    const row = document.createElement('div'); row.className = 'st';
    const full = s.type === 'prop' && BOARD.filter((x) => x.g === s.g).every((x) => V.owner[x.i] === token);
    const l = V.lvl[s.i];
    row.innerHTML = `<span class="sw" style="background:${s.color || '#5b6b92'}"></span><span class="stn">${esc(s.name)} ${l === 5 ? '🏨' : '🏠'.repeat(l)}</span>`;
    if (full) {
      const minus = document.createElement('button'); minus.textContent = '−'; minus.disabled = !myTurn || l === 0; minus.onclick = () => act('sell', s.i);
      const plus = document.createElement('button'); plus.textContent = '+'; plus.title = 'Построить за ' + fmt(s.cost); plus.disabled = !myTurn || l >= 5; plus.onclick = () => act('build', s.i);
      const cost = document.createElement('span'); cost.className = 'muted'; cost.textContent = fmt(s.cost);
      row.append(minus, plus, cost);
    }
    box.appendChild(row);
  }
}

function renderSqInfo() {
  const el = $('sqInfo');
  if (selSq === null || !BOARD[selSq]) { el.textContent = 'Нажми на клетку, чтобы увидеть детали'; return; }
  const s = BOARD[selSq];
  const ow = V && V.owner[s.i] ? pById(V.owner[s.i]) : null;
  let d = `<b>${esc(s.name)}</b>`;
  if (s.type === 'prop') d += ` · ${fmt(s.price)}<br>Аренда: ${fmt(s.rents[0])} · дома: ${s.rents.slice(1, 5).map(fmt).join(' / ')} · отель ${fmt(s.rents[5])}<br>Строение стоит ${fmt(s.cost)}`;
  else if (s.type === 'exch') d += ` · ${fmt(s.price)}<br>Аренда ${fmt(25)} / 50 / 100 / 200 — по числу твоих бирж`;
  else if (s.type === 'util') d += ` · ${fmt(s.price)}<br>Аренда: сумма кубиков ×4 (одна) или ×10 (обе)`;
  else if (s.type === 'tax') d += `<br>Заплати ${fmt(s.amount)} в банк`;
  else if (s.type === 'start') d += '<br>Проходишь — получаешь $200';
  else if (s.type === 'jail') d += '<br>Просто посетитель, либо заключён';
  else if (s.type === 'park') d += '<br>Забери накопленный банк налогов';
  else if (s.type === 'gojail') d += '<br>Отправляйся в Блокировку';
  else d += '<br>Тяни случайную карточку';
  if (ow) d += `<br>Владелец: ${esc(ow.name)}${V.lvl[s.i] ? ' · уровень ' + V.lvl[s.i] : ''}`;
  el.innerHTML = d;
}

setInterval(() => {
  const el = $('gTimer');
  if (!V || V.finished || !deadline) { el.textContent = ''; return; }
  const s = Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));
  el.textContent = '⏱ ' + s;
}, 300);

function showEnd() {
  show('scr-end');
  const st = V.standings, win = st[0];
  $('endTitle').textContent = win.id === token ? '🏆 Ты победил!' : `Победитель: ${win.name}`;
  $('endList').innerHTML = st.map((p, i) => `<div class="item"><span><span style="color:${PCOL[p.color]}">●</span> ${i + 1}. ${esc(p.name)}${p.id === token ? ' (ты)' : ''}${p.bankrupt ? ' · банкрот' : ''}</span><b>${fmt(p.worth)}</b></div>`).join('');
  $('endNote').textContent = canLive ? 'Живые игроки открыты — заходи в лобби!' : 'Тренировка засчитана.';
}
