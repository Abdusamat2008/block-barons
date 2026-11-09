'use strict';
// Block Barons — игровая логика (оригинальная игра, чистая логика без сети)

const COINS = [
  { id: 'BLK', name: 'BlockOre', color: '#f7b32b' },
  { id: 'VLT', name: 'Voltix', color: '#3ee6c4' },
  { id: 'MNT', name: 'MintDAO', color: '#a56bff' },
  { id: 'GRV', name: 'Gravel', color: '#ff5d73' },
];
const COIN_IDS = COINS.map((c) => c.id);

const EVENTS = [
  { title: 'Бычий рынок', text: 'Инвесторы в эйфории: всё растёт.', fx: { BLK: 0.1, VLT: 0.1, MNT: 0.1, GRV: 0.1 } },
  { title: 'Налёт регуляторов', text: 'Проверки по всем биржам, рынок падает.', fx: { BLK: -0.12, VLT: -0.12, MNT: -0.12, GRV: -0.12 } },
  { title: 'Взлом биржи', text: 'Хакеры вынесли хранилище. Voltix теряет доверие.', fx: { VLT: -0.25, BLK: 0.05 } },
  { title: 'Крупный партнёр', text: 'BlockOre заключил контракт с банком.', fx: { BLK: 0.25 } },
  { title: 'Мем-ралли', text: 'Gravel взорвал соцсети.', fx: { GRV: 0.35, MNT: -0.05 } },
  { title: 'Утечка кошельков', text: 'MintDAO под ударом, деньги бегут в BlockOre.', fx: { MNT: -0.2, BLK: 0.08 } },
  { title: 'Обновление сети', text: 'Voltix выпустил долгожданный апдейт.', fx: { VLT: 0.22, GRV: -0.05 } },
  { title: 'Китовый сброс', text: 'Кит распродаёт запасы Gravel и MintDAO.', fx: { GRV: -0.3, MNT: -0.15 } },
  { title: 'Спокойный день', text: 'Почти ничего не происходит.', fx: { BLK: 0.01, VLT: -0.01, MNT: 0.02, GRV: -0.02 } },
  { title: 'Листинг на бирже', text: 'MintDAO попал в большой листинг.', fx: { MNT: 0.3 } },
  { title: 'Паника на рынке', text: 'Все бегут в кэш. Сильное падение.', fx: { BLK: -0.2, VLT: -0.2, MNT: -0.2, GRV: -0.2 } },
  { title: 'Ребаланс фондов', text: 'Фонды перекладываются: Voltix и BlockOre растут, Gravel падает.', fx: { VLT: 0.12, BLK: 0.12, GRV: -0.12 } },
];

const CARDS = {
  PUMP: { name: 'Накачка', text: 'Выбранная монета +15% в конце раунда' },
  DUMP: { name: 'Слив', text: 'Выбранная монета −15% в конце раунда' },
  INSIDER: { name: 'Инсайд', text: 'Узнай событие следующего раунда заранее' },
};
const CARD_TYPES = Object.keys(CARDS);

function rnd(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rnd(arr.length)]; }
function r2(x) { return Math.round(x * 100) / 100; }

class Game {
  constructor(opts) {
    this.rounds = opts.rounds || 10;
    this.round = 1;
    this.startCash = opts.startCash || 1000;
    this.prices = {};
    COIN_IDS.forEach((c) => (this.prices[c] = 100));
    this.history = [{ ...this.prices }];
    this.players = opts.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: !!p.isBot,
      cash: this.startCash,
      hold: Object.fromEntries(COIN_IDS.map((c) => [c, 0])),
      cards: [],
      submitted: false,
      orders: {},
      card: null,
      tip: null,
    }));
    this.queue = [pick(EVENTS), pick(EVENTS)];
    this.last = null; // результат прошлого раунда
    this.finished = false;
    this.players.forEach((p) => this.deal(p));
  }

  deal(p) {
    if (p.cards.length < 3) p.cards.push(pick(CARD_TYPES));
  }

  netWorth(p) {
    return r2(p.cash + COIN_IDS.reduce((s, c) => s + p.hold[c] * this.prices[c], 0));
  }

  player(id) { return this.players.find((p) => p.id === id); }

  // orders: {coin: int}, card: {type, coin} | null
  submit(id, orders, card) {
    const p = this.player(id);
    if (!p || this.finished) return false;
    const clean = {};
    if (orders && typeof orders === 'object') {
      for (const c of COIN_IDS) {
        const n = Math.trunc(Number(orders[c]) || 0);
        if (n) clean[c] = Math.max(-200, Math.min(200, n));
      }
    }
    let cc = null;
    if (card && CARDS[card.type] && p.cards.includes(card.type)) {
      cc = { type: card.type, coin: COIN_IDS.includes(card.coin) ? card.coin : pick(COIN_IDS) };
    }
    p.orders = clean;
    p.card = cc;
    p.submitted = true;
    return true;
  }

  allSubmitted() { return this.players.every((p) => p.submitted); }

  resolve() {
    const demand = Object.fromEntries(COIN_IDS.map((c) => [c, 0]));
    const trades = [];
    // 1. сделки по ценам начала раунда: сначала продажи, потом покупки
    for (const p of this.players) {
      const done = {};
      for (const c of COIN_IDS) {
        const n = p.orders[c] || 0;
        if (n < 0) {
          const q = Math.min(-n, p.hold[c]);
          if (q > 0) { p.hold[c] -= q; p.cash = r2(p.cash + q * this.prices[c]); demand[c] -= q; done[c] = -q; }
        }
      }
      for (const c of COIN_IDS) {
        const n = p.orders[c] || 0;
        if (n > 0) {
          const q = Math.min(n, Math.floor(p.cash / this.prices[c]));
          if (q > 0) { p.hold[c] += q; p.cash = r2(p.cash - q * this.prices[c]); demand[c] += q; done[c] = q; }
        }
      }
      trades.push({ id: p.id, name: p.name, done });
    }
    // 2. рыночное влияние
    for (const c of COIN_IDS) {
      const imp = Math.max(-0.25, Math.min(0.25, 0.012 * demand[c]));
      this.prices[c] *= 1 + imp;
    }
    // 3. карты
    const played = [];
    for (const p of this.players) {
      if (!p.card) continue;
      const { type, coin } = p.card;
      const idx = p.cards.indexOf(type);
      if (idx >= 0) p.cards.splice(idx, 1);
      if (type === 'PUMP') this.prices[coin] *= 1.15;
      if (type === 'DUMP') this.prices[coin] *= 0.85;
      if (type === 'INSIDER') {
        const ev = this.queue[1];
        p.tip = { round: this.round + 1, title: ev.title, text: ev.text, fx: ev.fx };
      }
      played.push({ id: p.id, name: p.name, type, coin: type === 'INSIDER' ? null : coin });
    }
    // 4. событие раунда
    const ev = this.queue.shift();
    this.queue.push(pick(EVENTS));
    for (const [c, f] of Object.entries(ev.fx)) this.prices[c] *= 1 + f;
    for (const c of COIN_IDS) this.prices[c] = Math.max(5, r2(this.prices[c]));
    this.history.push({ ...this.prices });
    this.last = { round: this.round, event: { title: ev.title, text: ev.text, fx: ev.fx }, played, trades };
    // 5. новый раунд
    for (const p of this.players) {
      p.submitted = false; p.orders = {}; p.card = null;
      if (p.tip && p.tip.round <= this.round) p.tip = null;
    }
    this.round++;
    if (this.round > this.rounds) {
      this.finished = true;
    } else {
      this.players.forEach((p) => this.deal(p));
    }
  }

  standings() {
    return this.players
      .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, worth: this.netWorth(p) }))
      .sort((a, b) => b.worth - a.worth);
  }

  view(id) {
    const me = this.player(id);
    return {
      round: Math.min(this.round, this.rounds),
      rounds: this.rounds,
      finished: this.finished,
      prices: this.prices,
      history: this.history.slice(-24),
      me: me && {
        cash: me.cash, hold: me.hold, cards: me.cards, submitted: me.submitted,
        tip: me.tip, worth: this.netWorth(me),
      },
      players: this.standings().map((s) => ({ ...s, submitted: !!this.player(s.id).submitted })),
      last: this.last,
      standings: this.finished ? this.standings() : null,
    };
  }
}

// ----- Боты -----
function botDecide(game, p) {
  const orders = {};
  let cash = p.cash;
  const h = game.history;
  for (const c of COIN_IDS.slice().sort(() => Math.random() - 0.5)) {
    const last = h[h.length - 1][c];
    const prev = h.length > 1 ? h[h.length - 2][c] : last;
    const trend = (last - prev) / prev;
    const r = Math.random();
    if (p.hold[c] > 0 && (trend < -0.06 || r < 0.12)) {
      orders[c] = -Math.min(p.hold[c], 1 + rnd(3));
    } else if (cash > last * 2 && (trend > 0.02 || r < 0.35)) {
      const maxQ = Math.min(4, Math.floor(cash / last / 2));
      const q = 1 + rnd(Math.max(1, maxQ));
      orders[c] = q;
      cash -= q * last;
    }
  }
  let card = null;
  if (p.cards.length && Math.random() < 0.45) {
    const type = pick(p.cards);
    let coin = pick(COIN_IDS);
    if (type === 'PUMP') coin = COIN_IDS.slice().sort((a, b) => p.hold[b] - p.hold[a])[0];
    if (type === 'DUMP') coin = COIN_IDS.slice().sort((a, b) => p.hold[a] - p.hold[b])[0];
    card = { type, coin };
  }
  return { orders, card };
}

module.exports = { Game, botDecide, COINS, COIN_IDS, EVENTS, CARDS };
