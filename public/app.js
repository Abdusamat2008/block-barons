'use strict';
const $ = (id) => document.getElementById(id);
const fmt = (n) => '$' + Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PCOL = ['#ff5d73', '#3ee6c4', '#f7b32b', '#a56bff', '#38bdf8', '#fb923c'];
const FACES = ['⚀', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const ICONS = { start: '➜', work: '💼', shop: '🛒', lottery: '🎟️', crisis: '⚠️', strike: '⛏️', auction: '🔨', reversal: '🔄', expand: '🏭', tax: '💡', luck: '🍀', hack: '🕵️', boom: '🚀', investor: '🤝' };
const TCOL = { start: '#38d98a', work: '#38bdf8', shop: '#f7b32b', lottery: '#f472b6', crisis: '#ff5d73', strike: '#fb923c', auction: '#a56bff', reversal: '#3ee6c4', expand: '#f7b32b', tax: '#8fa0c4', luck: '#38d98a', hack: '#ff5d73', boom: '#a56bff', investor: '#38bdf8' };
const CELL_INFO = {
  start: 'Проход или остановка: +$100.',
  work: 'Работа: получи $150.',
  shop: 'Магазин карт: купи видеокарту со скидкой 20% (нужен свободный слот).',
  lottery: 'Лотерея: билет $50. Кубик 4 → $100, 5 → $200, 6 → $400, иначе ничего.',
  crisis: 'Кризис: вытягивается карточка, она действует на всех игроков.',
  strike: 'Майнинг-рывок: все твои видеокарты добывают ещё раз, без расходов на свет.',
  auction: 'Аукцион: тайные ставки. Карта достаётся тому, кто поставил больше. Нужен свободный слот.',
  reversal: 'Разворот рынка: оба курса идут в обратную сторону от прошлого изменения.',
  expand: 'Расширение фермы: новый слот за $300 (всего до 6).',
  tax: 'Счёт за свет: $20 за каждую видеокарту.',
  luck: 'Удача: +1 очко удачи (до 5). Очко двигает курс монеты на 1.',
  hack: 'Хакеры крадут 1 монету из самой дорогой твоей кучки.',
  boom: 'Биржевой бум: курс монеты, которой у тебя больше, растёт на 2.',
  investor: 'Инвестор: +$40 за каждую твою видеокарту.',
};

let token = localStorage.getItem('bb_token') || '';
let name = localStorage.getItem('bb_name') || '';
let profile = null, canLive = false, ws = null, S = null; // S — статические данные игры
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
      profile = m.profile; canLive = m.canLive; S = m;
      buildBoard();
      if (!lobby && !V) afterLogin();
      break;
    case 'profile': profile = m.profile; canLive = m.canLive; updateMenu(); break;
    case 'lobbies': renderLobbies(m.list); break;
    case 'lobby': lobby = m.lobby; if (lobby.state === 'waiting') renderRoom(); break;
    case 'game': onGame(m); break;
    case 'left': case 'closed': lobby = null; V = null; selSq = null; shown = {}; lastSeq = -1; $('auction').classList.add('hidden'); updateMenu(); show('scr-menu'); send({ t: 'list' }); break;
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

$('btnPractice').onclick = () => send({ t: 'practice', bots: 3, rounds: 10 });
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
    d.innerHTML = `<div><b></b><div class="muted">${l.players.length}/${l.max} · ${l.rounds} раундов · ${fmt(l.startCash)}${l.fillBots ? ' · боты' : ''}</div></div>`;
    d.querySelector('b').textContent = l.name;
    const b = document.createElement('button'); b.className = 'btn small primary'; b.textContent = 'Войти';
    b.onclick = () => send({ t: 'join', id: l.id }); d.appendChild(b); el.appendChild(d);
  }
}
function renderRoom() {
  show('scr-room');
  $('roomTitle').textContent = lobby.name;
  $('roomInfo').textContent = `${lobby.private ? 'Закрытое' : 'Открытое'} · ${lobby.players.length}/${lobby.max} · ${lobby.rounds} раундов · ${fmt(lobby.startCash)}`;
  $('roomCode').textContent = lobby.code ? 'КОД: ' + lobby.code : '';
  const el = $('roomPlayers'); el.innerHTML = '';
  for (const p of lobby.players) { const d = document.createElement('div'); d.className = 'item'; d.textContent = (p.host ? '👑 ' : '') + p.name; el.appendChild(d); }
  $('btnStart').style.display = lobby.host === token ? '' : 'none';
}

// ---------------- обучение ----------------
const STEPS = [
  ['Цель игры', 'Ты — крипто-босс. Построй майнинг-ферму, торгуй на бирже и обгони соперников. Когда раунды закончатся, считается капитал: деньги + монеты по текущему курсу + видеокарты (по половине цены) + слоты фермы − кредиты. Секретная цель из твоей карточки даёт ещё +$500.'],
  ['Твой ход', 'Ход состоит из трёх частей: 1) бросаешь кубики и идёшь по кругу, 2) выполняешь клетку, на которую встал, 3) этап рынка: торгуешь монетами, берёшь кредиты, тратишь удачу и настраиваешь видеокарты. Потом нажимаешь «Завершить ход».'],
  ['Ферма и видеокарты', 'У тебя есть слоты фермы (сначала 2). В слот ставится видеокарта: Старт-карта, Про-карта или Квант-рига. В конце каждого раунда карта добывает монеты, сколько у неё мощности. За электричество платишь $20 за единицу мощности. Для каждой карты выбери монету (Нова или Атлас) или выключи её, если добыча не окупает свет.'],
  ['Две монеты', 'Нова — нестабильная: её курс прыгает сильно, можно быстро выиграть или проиграть. Атлас — стабильная и меняется плавно. Курсы обновляются в начале каждого раунда. Покупай дёшево, продавай дорого.'],
  ['Клетки поля', 'Работа даёт деньги. Магазин и Аукцион дают видеокарты (на аукционе ставки тайные). Расширение даёт новый слот. Лотерея — азарт. Разворот рынка меняет курсы наоборот. Кризис бьёт по всем. Хакеры крадут монету. Майнинг-рывок — внеплановая добыча.'],
  ['Кредиты и удача', 'Кредит $500 под 10% или $1000 под 20%: проценты платятся в конце каждого раунда. Погасить можно в любой момент на этапе рынка. Очки удачи (их дают клетки «Удача») двигают курс выбранной монеты на 1 вверх или вниз, максимум 2 за ход.'],
  ['Цель и конец', 'В начале игры ты получаешь секретную карточку цели: например, «владей 4 видеокартами» или «закончи без кредитов». Выполнил — +$500 к итогу. Сыграй тренировку с ботами: после неё откроются живые игроки и свои лобби.'],
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
  if (finished && tFirst) send({ t: 'practice', bots: 3, rounds: 10 });
}
$('tNext').onclick = () => { if (tIdx < STEPS.length - 1) { tIdx++; renderStep(); } else closeTutorial(true); };
$('tBack').onclick = () => { if (tIdx) { tIdx--; renderStep(); } };
$('tSkip').onclick = () => { $('tutorial').classList.add('hidden'); localStorage.setItem('bb_tut', '1'); if (profile && !profile.tutorialDone) send({ t: 'tutorialDone' }); };

// ---------------- поле ----------------
function gridPos(i) { // кольцо 7×7, 24 клетки, СТАРТ внизу справа, движение против часовой
  if (i <= 6) return [7, 7 - i];
  if (i <= 12) return [7 - (i - 6), 1];
  if (i <= 18) return [1, 1 + (i - 12)];
  return [1 + (i - 18), 7];
}
function buildBoard() {
  const b = $('board');
  [...b.children].forEach((c) => { if (c.id !== 'center') c.remove(); });
  cells = S.board.map((s) => {
    const el = document.createElement('div');
    const [r, c] = gridPos(s.i);
    el.className = 'cell'; el.style.gridRow = r; el.style.gridColumn = c;
    el.innerHTML = `<div class="bar" style="background:${TCOL[s.type]}"></div><div class="ic">${ICONS[s.type]}</div><div class="nm">${esc(s.name)}</div><div class="tokens"></div>`;
    el.onclick = () => { selSq = s.i; renderSqInfo(); };
    b.appendChild(el);
    return { el, tokens: el.querySelector('.tokens') };
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
const coinName = (c) => S.coins.find((x) => x.id === c).name;
const coinColor = (c) => S.coins.find((x) => x.id === c).color;

function onGame(m) {
  const first = !V;
  V = m.view; deadline = m.deadline; offset = m.now - Date.now();
  if (V.finished) { $('auction').classList.add('hidden'); renderBoardState(); return showEnd(); }
  show('scr-game');
  for (const p of V.players) {
    if (shown[p.id] === undefined || first) { shown[p.id] = p.pos; continue; }
    if (shown[p.id] !== p.pos) {
      const steps = (p.pos - shown[p.id] + 24) % 24;
      if (steps <= 12) walkTo(p.id); else if (!walking[p.id]) shown[p.id] = p.pos;
    }
  }
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
    if (shown[id] === p.pos) { walking[id] = false; renderTokens(); renderActions(); renderMarket(); renderFarm(); return; }
    shown[id] = (shown[id] + 1) % 24; renderTokens(); setTimeout(tick, 120);
  };
  tick();
}
function setDice() { $('die1').textContent = FACES[V.dice[0]]; $('die2').textContent = FACES[V.dice[1]]; }
function rollDice() {
  for (const id of ['die1', 'die2']) { const d = $(id); d.classList.remove('roll'); void d.offsetWidth; d.classList.add('roll'); }
  setTimeout(setDice, 300);
}

function renderAll() { renderBoardState(); renderPanel(); renderActions(); renderMarket(); renderFarm(); renderSqInfo(); renderCenter(); renderAuction(); }

function renderBoardState() { renderTokens(); }
function renderTokens() {
  cells.forEach((c) => (c.tokens.innerHTML = ''));
  for (const p of V.players) {
    const pos = shown[p.id] === undefined ? p.pos : shown[p.id];
    const t = document.createElement('div');
    t.className = 'tok' + (p.id === V.cur && !V.finished ? ' cur' : '');
    t.style.background = PCOL[p.color]; t.title = p.name;
    cells[pos].tokens.appendChild(t);
  }
}

function phaseText() {
  const p = pById(V.cur); if (!p) return '';
  if (V.phase === 'auction') return 'Идёт аукцион: тайные ставки';
  const who = p.id === token ? 'Твой ход' : `Ходит ${p.name}`;
  if (V.phase === 'roll') return `${who}: бросок кубиков`;
  if (V.phase === 'cell') return `${who}: решает на клетке`;
  return `${who}: рынок и ферма`;
}
function sparkHtml(hist, color) {
  const mx = Math.max(...hist), mn = Math.min(...hist);
  return '<div class="spark" style="color:' + color + '">' + hist.map((v) => `<i style="height:${Math.round(20 + 80 * (v - mn) / Math.max(1, mx - mn))}%"></i>`).join('') + '</div>';
}
function renderCenter() {
  $('rates').innerHTML = S.coins.map((c) => {
    const r = V.rates[c.id], up = r.delta > 0, dn = r.delta < 0;
    return `<div class="rate"><span style="color:${c.color};font-weight:800">${c.name}</span><b>${fmt(r.price)}</b>` +
      `<span class="${up ? 'up' : dn ? 'down' : 'muted'}">${up ? '▲' : dn ? '▼' : '•'} ${r.delta ? Math.abs(r.delta) + ' ш.' : 'без изменений'}</span>${sparkHtml(V.history[c.id], c.color)}</div>`;
  }).join('');
  $('turnInfo').textContent = phaseText();
  $('crisisInfo').textContent = V.crisis ? `⚠ ${V.crisis.text}` : '';
}

function renderPanel() {
  $('gRound').textContent = `Раунд ${V.round}/${V.rounds}`;
  const fl = [];
  if (V.flags.noProfit) fl.push('⚠ добычи нет'); if (V.flags.elecX2) fl.push('⚡ свет ×2'); if (V.flags.halve) fl.push('⛏ добыча ÷2');
  $('gFlags').textContent = fl.join(' · ');
  $('gPlayers').innerHTML = V.players.map((p) =>
    `<div class="pl ${p.id === V.cur ? 'turn' : ''}"><span class="dot" style="background:${PCOL[p.color]}"></span>` +
    `<span class="nmx">${esc(p.name)}${p.id === token ? ' (ты)' : ''}</span>` +
    `<span class="muted">🖥${p.cards.length} · Н${p.coins.N} А${p.coins.A}</span><b>${fmt(p.worth)}</b></div>`).join('');
  const m = me();
  const g = m && m.goal;
  $('myGoal').className = 'goal' + (g && g.done ? ' done' : '');
  $('myGoal').textContent = g ? `🎯 Секретная цель (+$${S.consts.GOAL_BONUS}): ${g.text}${g.done ? ' — выполняется сейчас ✔' : ''}` : '';
  $('gLog').innerHTML = V.log.map((l) => `<div>${esc(l)}</div>`).join('');
}

function renderActions() {
  const box = $('actions'); box.innerHTML = '';
  const m = me();
  const btn = (txt, cls, fn, dis) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = txt; b.disabled = !!dis; b.onclick = fn; box.appendChild(b); };
  const hint = (t) => { const h = document.createElement('div'); h.className = 'hint'; h.textContent = t; box.appendChild(h); };
  if (!m) return;
  if (V.phase === 'auction') { hint('Идёт аукцион — смотри окно со ставками.'); return; }
  if (V.cur !== token) { hint(`Ждём: ${pById(V.cur).name}`); return; }
  if (walking[token]) { hint('Фишка движется…'); return; }
  if (V.phase === 'roll') btn('🎲 Бросить кубики', 'primary', () => act('roll'));
  else if (V.phase === 'cell') {
    const t = V.pending && V.pending.type, free = m.slots - m.cards.length;
    if (t === 'shop') {
      hint(`Магазин: скидка 20%, свободных слотов: ${free}`);
      for (const c of S.cards) { const cost = Math.round(c.cost * S.consts.SHOP_DISC); btn(`${c.name} (⚡${c.power}) — ${fmt(cost)}`, 'good', () => act('buyCard', { k: c.tier }), m.cash < cost || free < 1); }
    } else if (t === 'expand') {
      hint(`Расширение: слотов ${m.slots}/${S.consts.MAX_SLOTS}`);
      btn(`Купить слот — ${fmt(S.consts.SLOT_COST)}`, 'good', () => act('buySlot'), m.cash < S.consts.SLOT_COST);
    } else if (t === 'lottery') {
      hint('Лотерея: билет $' + S.consts.LOTTERY_FEE + ', выигрыш до $400');
      btn(`Сыграть — ${fmt(S.consts.LOTTERY_FEE)}`, 'good', () => act('playLottery'), m.cash < S.consts.LOTTERY_FEE);
    }
    btn('Пропустить', 'bad', () => act('skip'));
  } else if (V.phase === 'market') {
    hint('Этап рынка: торгуй, бери кредиты, настраивай ферму. Потом заверши ход.');
    btn('Завершить ход', 'primary', () => act('endTurn'));
  }
}

function renderMarket() {
  const box = $('market'); const m = me();
  if (!m) { box.innerHTML = ''; return; }
  const on = V.cur === token && V.phase === 'market' && !walking[token];
  box.innerHTML = '<h3>Биржа и кредиты</h3>';
  const mk = (txt, fn, dis, title) => { const b = document.createElement('button'); b.textContent = txt; b.disabled = !dis; if (title) b.title = title; b.onclick = fn; return b; };
  for (const c of S.coins) {
    const pr = V.rates[c.id].price, have = m.coins[c.id];
    const row = document.createElement('div'); row.className = 'mrow';
    row.innerHTML = `<span class="nm" style="color:${c.color}">${c.name}</span><span>${fmt(pr)}</span><span class="muted">есть: ${have}</span><span class="sp"></span>`;
    row.append(
      mk('+1', () => act('trade', { coin: c.id, qty: 1 }), on && m.cash >= pr, 'Купить 1'),
      mk('+5', () => act('trade', { coin: c.id, qty: 5 }), on && m.cash >= pr * 5, 'Купить 5'),
      mk('−1', () => act('trade', { coin: c.id, qty: -1 }), on && have >= 1, 'Продать 1'),
      mk('−5', () => act('trade', { coin: c.id, qty: -5 }), on && have >= 5, 'Продать 5'),
      mk('всё', () => act('trade', { coin: c.id, qty: -have }), on && have > 0, 'Продать все'),
      mk('🍀▲', () => act('luck', { coin: c.id, dir: 1 }), on && m.luck > 0 && m.luckUsed < S.consts.LUCK_PER_TURN, 'Потратить удачу: курс +1'),
      mk('🍀▼', () => act('luck', { coin: c.id, dir: -1 }), on && m.luck > 0 && m.luckUsed < S.consts.LUCK_PER_TURN, 'Потратить удачу: курс −1'),
    );
    box.appendChild(row);
  }
  const lr = document.createElement('div'); lr.className = 'mrow';
  lr.innerHTML = `<span class="nm">Кредиты</span><span class="muted">долг ${fmt(m.loans[10] + m.loans[20])}</span><span class="sp"></span>`;
  for (const k of [10, 20]) {
    const ln = S.loans[k];
    if (m.loans[k] > 0) lr.append(mk(`Погасить ${k}% (${fmt(m.loans[k])})`, () => act('repay', { k }), on && m.cash >= m.loans[k]));
    else lr.append(mk(`Взять ${fmt(ln.amount)} под ${k}%`, () => act('loan', { k }), on));
  }
  box.appendChild(lr);
}

function renderFarm() {
  const box = $('farm'); const m = me();
  if (!m) { box.innerHTML = ''; return; }
  const on = V.cur === token && V.phase === 'market' && !walking[token];
  box.innerHTML = `<h3>Моя ферма</h3><div class="mrow"><span>💵 <b>${fmt(m.cash)}</b></span><span style="color:${coinColor('N')}">Нова ${m.coins.N}</span><span style="color:${coinColor('A')}">Атлас ${m.coins.A}</span><span>🍀 ${m.luck}</span><span class="sp"></span><span class="muted">капитал ${fmt(m.worth)}</span></div>`;
  const grid = document.createElement('div'); grid.className = 'farmgrid';
  for (let i = 0; i < S.consts.MAX_SLOTS; i++) {
    const d = document.createElement('div');
    if (i >= m.slots) { d.className = 'slot empty locked'; d.textContent = '🔒 слот (клетка «Расширение»)'; }
    else if (!m.cards[i]) { d.className = 'slot empty'; d.textContent = 'свободный слот'; }
    else {
      const c = m.cards[i], def = S.cards[c.tier - 1];
      d.className = 'slot';
      d.innerHTML = `<b>🖥 ${def.name}</b><span class="muted">⚡${def.power} · свет ${fmt(def.power * S.consts.ELEC)}/раунд</span>`;
      const sel = document.createElement('div'); sel.className = 'sel';
      for (const [k, label] of [['N', 'Нова'], ['A', 'Атлас'], ['off', '⏻']]) {
        const b = document.createElement('button'); b.textContent = label; b.disabled = !on; if (c.coin === k) b.classList.add('on');
        b.onclick = () => act('assign', { id: c.id, coin: k }); sel.appendChild(b);
      }
      d.appendChild(sel);
    }
    grid.appendChild(d);
  }
  box.appendChild(grid);
}

function renderAuction() {
  const modal = $('auction');
  const a = V.phase === 'auction' && V.auction;
  if (!a) { modal.classList.add('hidden'); return; }
  modal.classList.remove('hidden');
  const def = S.cards[a.tier - 1], m = me();
  $('aucCard').textContent = `🖥 ${def.name} (⚡${def.power}) — в магазине ${fmt(def.cost)}`;
  const elig = m && a.eligible.includes(token), done = a.bids[token];
  $('aucInfo').textContent = !elig ? 'У тебя нет свободного слота или денег — смотришь со стороны.' : done ? 'Твоя ставка принята. Ждём остальных…' : 'Поставь тайную ставку. Выигрывает наибольшая; при равных — тот, кто ближе к ходящему.';
  $('aucBid').disabled = !elig || done; $('aucBtn').disabled = !elig || done; $('aucPass').disabled = !elig || done;
  if (m) $('aucBid').max = m.cash;
  $('aucWho').textContent = 'Ставки сделали: ' + (a.eligible.map((id) => `${pById(id).name} ${a.bids[id] ? '✔' : '…'}`).join(' · ') || '—');
}
$('aucBtn').onclick = () => { const v = Math.max(0, Math.trunc(Number($('aucBid').value) || 0)); act('bid', { amount: v }); };
$('aucPass').onclick = () => act('bid', { amount: 0 });

function renderSqInfo() {
  const el = $('sqInfo');
  if (selSq === null || !S.board[selSq]) { el.textContent = 'Нажми на клетку, чтобы увидеть, что она делает'; return; }
  const s = S.board[selSq];
  el.innerHTML = `<b>${ICONS[s.type]} ${esc(s.name)}</b><br>${esc(CELL_INFO[s.type])}`;
}

setInterval(() => {
  const t = V && !V.finished && deadline ? '⏱ ' + Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000)) : '';
  $('gTimer').textContent = t; $('aucTimer').textContent = t;
}, 300);

function showEnd() {
  show('scr-end');
  const st = V.standings, win = st[0];
  $('endTitle').textContent = win.id === token ? '🏆 Ты — крипто-босс!' : `Победитель: ${win.name}`;
  $('endList').innerHTML = st.map((p, i) =>
    `<div class="item"><div><span style="color:${PCOL[p.color]}">●</span> ${i + 1}. ${esc(p.name)}${p.id === token ? ' (ты)' : ''}` +
    `<div class="muted" style="font-size:12px">капитал ${fmt(p.worth)} · цель «${esc(p.goal)}» ${p.done ? '✔ +' + fmt(p.bonus) : '✘'}</div></div><b>${fmt(p.score)}</b></div>`).join('');
  $('endNote').textContent = canLive ? 'Живые игроки открыты — заходи в лобби!' : 'Тренировка засчитана.';
}
