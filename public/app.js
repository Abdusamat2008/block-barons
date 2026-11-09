import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const fmt = (n) => '$' + Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

// ---------------- Сеть ----------------
let token = localStorage.getItem('bb_token') || '';
let name = localStorage.getItem('bb_name') || '';
let profile = null, canLive = false, COINS = [], CARDS = {};
let lobby = null, game = null, ws = null, offset = 0;
let orders = {}, selCard = null, selCoin = null;
let lastPrices = null;

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token, name }));
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = () => { toast('Соединение потеряно, переподключаюсь…'); setTimeout(connect, 1500); };
}
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 3000); }
function show(id) { document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active')); $(id).classList.add('active'); }

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      token = m.token; localStorage.setItem('bb_token', token);
      profile = m.profile; canLive = m.canLive; COINS = m.coins; CARDS = m.cards;
      buildTowers();
      if (!lobby && !game) { afterLogin(); }
      break;
    case 'profile': profile = m.profile; canLive = m.canLive; updateMenu(); break;
    case 'lobbies': renderLobbies(m.list); break;
    case 'lobby': lobby = m.lobby; if (lobby.state === 'waiting') renderRoom(); break;
    case 'game': onGame(m); break;
    case 'left': case 'closed': lobby = null; game = null; orders = {}; selCard = null; updateMenu(); show('scr-menu'); send({ t: 'list' }); break;
    case 'err': toast(m.msg); break;
    case 'chat': addLog('💬 ' + m.from + ': ' + m.text); break;
  }
}

// ---------------- Меню / вход ----------------
function afterLogin() {
  if (!profile.tutorialDone && !localStorage.getItem('bb_tut')) { updateMenu(); show('scr-menu'); openTutorial(true); }
  else { updateMenu(); show('scr-menu'); }
}
function updateMenu() {
  if (!profile) return;
  $('whoami').textContent = `${profile.name} · тренировок: ${profile.practiceGames} · побед: ${profile.wins}`;
  const live = canLive;
  $('lockIcon').textContent = live ? '🟢' : '🔒';
  $('btnLive').disabled = !live;
  $('lockNote').textContent = live ? '' : (!profile.tutorialDone ? 'Пройди обучение, чтобы открыть живые игры' : 'Доиграй 1 партию с ботами — откроются живые игроки');
}
$('btnEnter').onclick = () => {
  const v = $('nameInput').value.trim();
  if (!v) return toast('Введи ник');
  name = v; localStorage.setItem('bb_name', name);
  connect();
};
$('nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('btnEnter').click());
if (name) { $('nameInput').value = name; connect(); }

$('btnPractice').onclick = () => send({ t: 'practice', bots: 3, rounds: 8 });
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
$('btnEndMenu').onclick = () => { send({ t: 'leave' }); };

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

// ---------------- Обучение ----------------
const STEPS = [
  ['Цель игры', 'Ты — барон крипторынка. У каждого игрока $1000 и 4 монеты: BlockOre, Voltix, MintDAO и Gravel. Через несколько раундов побеждает тот, у кого больше всего капитала (наличные + монеты по текущим ценам).'],
  ['Покупка и продажа', 'В каждом раунде у тебя 30 секунд. Кнопками + и − под монетой выбери, сколько штук купить или продать. Купить монету дёшево и продать дороже — вот и вся прибыль.'],
  ['Влияние на цену', 'Когда игроки массово покупают монету, её цена растёт. Когда продают — падает. Следи, что делают соперники: рейтинг слева показывает капитал каждого.'],
  ['События рынка', 'В конце каждого раунда случается событие: взлом, листинг, паника, мем-ралли. Оно меняет цены сильнее всего. Предугадай его — и ты в плюсе.'],
  ['Карты', 'Каждый раунд ты получаешь карту (максимум 3 в руке). «Накачка» поднимает выбранную монету на 15%, «Слив» опускает на 15%, «Инсайд» показывает событие следующего раунда. Выбери карту, затем монету.'],
  ['Готов?', 'Нажми «Готов», когда решил, или дождись конца таймера. Сначала сыграй партию с ботами — после неё откроются живые игроки и свои лобби.'],
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
  if (finished && tFirst) send({ t: 'practice', bots: 3, rounds: 8 });
}
$('tNext').onclick = () => { if (tIdx < STEPS.length - 1) { tIdx++; renderStep(); } else closeTutorial(true); };
$('tBack').onclick = () => { if (tIdx) { tIdx--; renderStep(); } };
$('tSkip').onclick = () => { $('tutorial').classList.add('hidden'); localStorage.setItem('bb_tut', '1'); if (profile && !profile.tutorialDone) send({ t: 'tutorialDone' }); };

// ---------------- Игра ----------------
function addLog(t) { const el = $('gLog'); const d = document.createElement('div'); d.textContent = t; el.prepend(d); while (el.children.length > 8) el.lastChild.remove(); }

function onGame(m) {
  const first = !game;
  game = m; offset = m.now - Date.now();
  const v = m.view;
  if (first || m.phase === 'plan' && m._newRound !== v.round) { /* сброс заказов при новом раунде */ }
  if (!onGame.lastRound || onGame.lastRound !== v.round || (first)) { orders = {}; selCard = null; selCoin = null; onGame.lastRound = v.round; }
  if (v.finished) { return showEnd(v); }
  show('scr-game');
  if (m.phase === 'result' && v.last && onGame.logged !== v.last.round) {
    onGame.logged = v.last.round;
    addLog(`Раунд ${v.last.round}: ${v.last.event.title}`);
    for (const p of v.last.played) addLog(`${p.name}: «${CARDS[p.type].name}»${p.coin ? ' → ' + p.coin : ''}`);
  }
  render(); setTargets(v);
}

function render() {
  const m = game, v = m.view;
  $('gRound').textContent = `Раунд ${v.round}/${v.rounds}`;
  $('gPhase').textContent = m.phase === 'plan' ? '· твой ход' : '· итоги раунда';
  const me = v.me;
  $('gCash').textContent = fmt(me.cash - spend());
  $('gWorth').textContent = fmt(me.worth);
  // игроки
  $('gPlayers').innerHTML = v.players.map((p, i) => `<div class="prow ${p.id === token ? 'me' : ''}"><span>${i + 1}. ${esc(p.name)}</span><span>${m.phase === 'plan' && p.submitted ? '<span class="ok">✔</span> ' : ''}${fmt(p.worth)}</span></div>`).join('');
  // событие / подсказка
  let ev = '';
  if (me.tip && me.tip.round === v.round + 1) ev += `🔮 Инсайд на раунд ${me.tip.round}: <b>${esc(me.tip.title)}</b> — ${esc(me.tip.text)}<br>`;
  if (v.last) ev += `Прошлое событие: <b>${esc(v.last.event.title)}</b> — ${esc(v.last.event.text)}`;
  else ev += 'Первый раунд. События влияют на цены в конце каждого раунда.';
  $('gEvent').innerHTML = ev;
  // рынок
  const prev = v.history.length > 1 ? v.history[v.history.length - 2] : v.prices;
  const plan = m.phase === 'plan' && !me.submitted;
  $('gMarket').innerHTML = '';
  for (const c of COINS) {
    const price = v.prices[c.id], ch = (price - prev[c.id]) / prev[c.id] * 100;
    const q = orders[c.id] || 0;
    const d = document.createElement('div'); d.className = 'coin' + (selCoin === c.id ? ' sel' : '');
    d.style.borderColor = c.color + '66';
    d.innerHTML = `<div class="nm"><span style="color:${c.color}">${c.id}</span><span class="ch ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'}${Math.abs(ch).toFixed(1)}%</span></div>
      <div class="pr">${fmt(price)}</div><div class="own">Есть: ${me.hold[c.id]}</div>
      <div class="ctl"><button data-d="-1" ${plan ? '' : 'disabled'}>−</button><span class="q">${q > 0 ? '+' + q : q}</span><button data-d="1" ${plan ? '' : 'disabled'}>+</button></div>`;
    d.onclick = (e) => { if (e.target.tagName === 'BUTTON') return; if (selCard && selCard !== 'INSIDER') { selCoin = c.id; render(); } };
    d.querySelectorAll('button').forEach((b) => (b.onclick = () => changeOrder(c.id, +b.dataset.d)));
    $('gMarket').appendChild(d);
  }
  // карты
  $('gCards').innerHTML = '';
  me.cards.forEach((type, i) => {
    const b = document.createElement('div'); b.className = 'gcard' + (selCard === type ? ' on' : '');
    b.innerHTML = `<b>${CARDS[type].name}</b><small>${CARDS[type].text}</small>`;
    b.onclick = () => { if (!plan) return; selCard = selCard === type ? null : type; if (selCard === 'INSIDER') selCoin = null; render(); };
    $('gCards').appendChild(b);
  });
  if (selCard && selCard !== 'INSIDER' && !selCoin) $('gEvent').innerHTML += '<br>👉 Выбери монету для карты (нажми на неё).';
  $('btnReady').disabled = !plan;
  $('btnReady').textContent = me.submitted ? 'Ждём остальных…' : 'Готов';
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function spend() { // чистые траты (покупки − продажи) по текущим ценам
  if (!game) return 0;
  return COINS.reduce((s, c) => s + (orders[c.id] || 0) * game.view.prices[c.id], 0);
}
function changeOrder(id, d) {
  const v = game.view, me = v.me;
  let q = (orders[id] || 0) + d;
  if (q < -me.hold[id]) q = -me.hold[id];
  if (q > 0) { const others = spend() - (orders[id] || 0) * v.prices[id]; if (me.cash - others - q * v.prices[id] < 0) q = orders[id] || 0; }
  orders[id] = q; render();
}
$('btnReady').onclick = () => {
  if (!game || game.phase !== 'plan') return;
  const card = selCard && (selCard === 'INSIDER' || selCoin) ? { type: selCard, coin: selCoin } : null;
  if (selCard && !card) return toast('Выбери монету для карты');
  send({ t: 'submit', orders, card });
};

setInterval(() => {
  if (!game || !game.deadline) { $('gTimer').textContent = ''; return; }
  const s = Math.max(0, Math.ceil((game.deadline - (Date.now() + offset)) / 1000));
  $('gTimer').textContent = s + ' с';
}, 250);

function showEnd(v) {
  show('scr-end');
  const win = v.standings[0];
  $('endTitle').textContent = win.id === token ? '🏆 Ты победил!' : `Победитель: ${win.name}`;
  $('endList').innerHTML = v.standings.map((p, i) => `<div class="item"><span>${i + 1}. ${esc(p.name)}${p.id === token ? ' (ты)' : ''}</span><b>${fmt(p.worth)}</b></div>`).join('');
  $('endNote').textContent = canLive ? 'Живые игроки открыты — заходи в лобби!' : 'Тренировка засчитана.';
}

// ---------------- 3D сцена ----------------
const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x070b14);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070b14, 0.035);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
scene.add(new THREE.AmbientLight(0x6b7fb0, 0.8));
const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(6, 10, 6); scene.add(key);
const rim = new THREE.PointLight(0xf7b32b, 40, 40); rim.position.set(-6, 5, -4); scene.add(rim);

const base = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.8, 0.6, 6), new THREE.MeshStandardMaterial({ color: 0x0f1a33, metalness: 0.6, roughness: 0.35 }));
base.position.y = -0.3; scene.add(base);
const grid = new THREE.GridHelper(14, 14, 0x2a4a8a, 0x15264a); grid.position.y = 0.01; scene.add(grid);

// звёзды
{ const g = new THREE.BufferGeometry(); const n = 600, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = (Math.random() - 0.5) * 80; a[i * 3 + 1] = Math.random() * 30 + 2; a[i * 3 + 2] = (Math.random() - 0.5) * 80; }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3)); scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9db4ff, size: 0.12 }))); }

const towers = {};
let labelEls = {};
function buildTowers() {
  Object.values(towers).forEach((t) => scene.remove(t.group)); $('labels').innerHTML = ''; labelEls = {};
  COINS.forEach((c, i) => {
    const col = new THREE.Color(c.color);
    const group = new THREE.Group();
    const x = (i - (COINS.length - 1) / 2) * 3.2;
    group.position.set(x, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, metalness: 0.5, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.15, 1, 6), mat); body.position.y = 0.5; group.add(body);
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.14, 32), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, metalness: 0.9, roughness: 0.2 }));
    coin.rotation.x = Math.PI / 2; group.add(coin);
    scene.add(group);
    towers[c.id] = { group, body, coin, mat, h: 1, target: 1, flash: 0, dir: 0 };
    const el = document.createElement('div'); el.className = 'lbl'; el.style.color = c.color; $('labels').appendChild(el); labelEls[c.id] = el;
  });
}
function setTargets(v) {
  for (const c of COINS) {
    const t = towers[c.id]; if (!t) continue;
    t.target = Math.max(0.4, v.prices[c.id] / 22);
    if (lastPrices && lastPrices[c.id] !== v.prices[c.id]) { t.flash = 1; t.dir = v.prices[c.id] > lastPrices[c.id] ? 1 : -1; }
    const el = labelEls[c.id];
    if (el) {
      const prev = lastPrices ? lastPrices[c.id] : v.prices[c.id];
      const ch = (v.prices[c.id] - prev) / prev * 100;
      el.innerHTML = `${c.id}<small class="${ch >= 0 ? 'up' : 'down'}">${fmt(v.prices[c.id])} ${ch ? (ch > 0 ? '▲' : '▼') + Math.abs(ch).toFixed(1) + '%' : ''}</small>`;
    }
  }
  lastPrices = { ...v.prices };
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
let mx = 0, my = 0;
addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });

const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
function frame() {
  const dt = clock.getDelta(), t = clock.elapsedTime;
  const ang = t * 0.12 + mx * 0.8;
  const R = innerWidth < 720 ? 17 : 13;
  camera.position.set(Math.sin(ang) * R, 7 + my * 3, Math.cos(ang) * R);
  camera.lookAt(0, 2, 0);
  for (const c of COINS) {
    const tw = towers[c.id]; if (!tw) continue;
    tw.h += (tw.target - tw.h) * Math.min(1, dt * 3);
    tw.body.scale.y = tw.h; tw.body.position.y = tw.h / 2;
    tw.coin.position.y = tw.h + 1 + Math.sin(t * 2 + tw.group.position.x) * 0.15;
    tw.coin.rotation.z += dt * 1.5;
    tw.flash = Math.max(0, tw.flash - dt * 0.8);
    tw.mat.emissiveIntensity = 0.25 + tw.flash * 1.2;
    const el = labelEls[c.id];
    if (el) {
      tmp.set(tw.group.position.x, tw.coin.position.y + 0.9, 0).project(camera);
      el.style.left = (tmp.x * 0.5 + 0.5) * innerWidth + 'px';
      el.style.top = (-tmp.y * 0.5 + 0.5) * innerHeight + 'px';
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
