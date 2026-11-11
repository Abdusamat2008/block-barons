'use strict';
// Block Barons — настольная игра про крипто-ферму. Оригинальные названия, цифры и карточки.
// Ход: бросок -> клетка -> рынок (торговля, кредиты, удача, настройка карт). Конец раунда: добыча.

const COINS = [
  { id: 'N', name: 'Нова', color: '#a56bff', prices: [5, 12, 20, 30, 40, 50, 65, 80, 100, 125], move: [-2, -1, 0, 0, 1, 2] }, // нестабильная
  { id: 'A', name: 'Атлас', color: '#3ee6c4', prices: [15, 22, 30, 40, 50, 60, 70, 80, 90, 100], move: [-1, -1, 0, 0, 1, 1] }, // стабильная
];
const COIN_IDS = ['N', 'A'];
const CARDS = [
  { tier: 1, name: 'Старт-карта', power: 1, cost: 200 },
  { tier: 2, name: 'Про-карта', power: 3, cost: 500 },
  { tier: 3, name: 'Квант-рига', power: 6, cost: 1100 },
];
const LOANS = { 10: { rate: 0.1, amount: 500 }, 20: { rate: 0.2, amount: 1000 } };
const SLOT_COST = 300, MAX_SLOTS = 6, START_SLOTS = 2, ELEC = 20, SHOP_DISC = 0.8, SLOT_VALUE = 100;
const PASS_START = 100, WORK_PAY = 150, LOTTERY_FEE = 50, MAX_LUCK = 5, LUCK_PER_TURN = 2, MAX_IDX = 9;
const GOAL_BONUS = 500;

const BOARD = [
  ['start', 'СТАРТ'], ['work', 'Работа'], ['shop', 'Магазин карт'], ['lottery', 'Лотерея'], ['crisis', 'Кризис'], ['strike', 'Майнинг-рывок'], ['auction', 'Аукцион'],
  ['reversal', 'Разворот рынка'], ['work', 'Работа'], ['expand', 'Расширение фермы'], ['tax', 'Счёт за свет'], ['luck', 'Удача'], ['hack', 'Хакеры'],
  ['lottery', 'Лотерея'], ['auction', 'Аукцион'], ['work', 'Работа'], ['crisis', 'Кризис'], ['shop', 'Магазин карт'], ['boom', 'Биржевой бум'],
  ['luck', 'Удача'], ['strike', 'Майнинг-рывок'], ['expand', 'Расширение фермы'], ['investor', 'Инвестор'], ['reversal', 'Разворот рынка'],
].map(([type, name], i) => ({ i, type, name }));
const N_CELLS = BOARD.length;

const GOALS = [
  { id: 'miner', text: 'Владей 4 видеокартами', ok: (p) => p.cards.length >= 4 },
  { id: 'hodl', text: 'Накопи 12 монет (Нова + Атлас)', ok: (p) => p.coins.N + p.coins.A >= 12 },
  { id: 'nodebt', text: 'Закончи игру без кредитов', ok: (p) => p.loans[10] + p.loans[20] === 0 },
  { id: 'rich', text: 'Закончи игру с $2500 наличными', ok: (p) => p.cash >= 2500 },
  { id: 'quant', text: 'Владей Квант-ригой', ok: (p) => p.cards.some((c) => c.tier === 3) },
  { id: 'mix', text: 'Держи не меньше 4 монет каждого вида', ok: (p) => p.coins.N >= 4 && p.coins.A >= 4 },
  { id: 'worker', text: 'Останови фишку на «Работе» 3 раза', ok: (p) => p.workStops >= 3 },
];

const CRISES = [
  { t: 'Блэкаут в сети: в этом раунде добычи нет', fx: (g) => { g.flags.noProfit = true; } },
  { t: 'Запрет бирж: Нова падает на 3', fx: (g) => g.shift('N', -3) },
  { t: 'Крипто-хайп: оба курса растут на 1', fx: (g) => { g.shift('N', 1); g.shift('A', 1); } },
  { t: 'Взлом биржи: Атлас падает на 3', fx: (g) => g.shift('A', -3) },
  { t: 'Скачок цен на энергию: электричество ×2 в этом раунде', fx: (g) => { g.flags.elecX2 = true; } },
  { t: 'Налоговая проверка: все платят 5% наличных', fx: (g) => { for (const p of g.players) g.forcePay(p, Math.floor(p.cash * 0.05)); } },
  { t: 'Халвинг: добыча в этом раунде вдвое меньше', fx: (g) => { g.flags.halve = true; } },
  { t: 'Волна покупок: Нова растёт на 3', fx: (g) => g.shift('N', 3) },
];

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const die = () => 1 + rnd(6);
const clampI = (x, a, b) => Math.max(a, Math.min(b, x));
const fail = (err) => ({ ok: false, err });
const OK = { ok: true };

class Game {
  constructor(opts) {
    this.rounds = opts.rounds || 12;
    this.startCash = opts.startCash || 1000;
    this.cardSeq = 1;
    this.idx = { N: 4, A: 4 };
    this.lastDelta = { N: 0, A: 0 };
    this.history = { N: [this.price('N')], A: [this.price('A')] };
    this.players = opts.players.map((p, i) => ({
      id: p.id, name: p.name, isBot: !!p.isBot, human: !p.isBot, color: i,
      cash: this.startCash, coins: { N: 0, A: 0 }, slots: START_SLOTS, luck: 1, luckUsed: 0,
      loans: { 10: 0, 20: 0 }, pos: 0, workStops: 0,
      cards: [{ id: this.cardSeq++, tier: 1, coin: i % 2 ? 'A' : 'N' }],
      goal: pick(GOALS).id,
    }));
    this.round = 1;
    this.cur = 0;
    this.phase = 'roll'; // roll | cell | market | auction | over
    this.pending = null;
    this.auction = null;
    this.dice = [0, 0];
    this.seq = 0;
    this.flags = {};
    this.crisis = null;
    this.log = [];
    this.finished = false;
    this.say(`Игра началась! Курс: Нова $${this.price('N')}, Атлас $${this.price('A')}. Ходит ${this.players[0].name}.`);
  }

  say(t) { this.log.push(t); if (this.log.length > 60) this.log.shift(); }
  price(c) { return COINS.find((x) => x.id === c).prices[this.idx[c]]; }
  curPlayer() { return this.players[this.cur]; }
  player(id) { return this.players.find((p) => p.id === id); }
  freeSlots(p) { return p.slots - p.cards.length; }
  debt(p) { return p.loans[10] + p.loans[20]; }

  worth(p) {
    return Math.round(p.cash + p.coins.N * this.price('N') + p.coins.A * this.price('A')
      + p.cards.reduce((s, c) => s + CARDS[c.tier - 1].cost / 2, 0) + p.slots * SLOT_VALUE - this.debt(p));
  }

  // ---------- курсы ----------
  shift(c, d) {
    const old = this.idx[c];
    this.idx[c] = clampI(old + d, 0, MAX_IDX);
    const real = this.idx[c] - old;
    this.say(`${COINS.find((x) => x.id === c).name}: ${real >= 0 ? '▲' : '▼'} $${this.price(c)}`);
    return real;
  }
  rollRates() {
    for (const c of COIN_IDS) {
      const d = COINS.find((x) => x.id === c).move[rnd(6)];
      const old = this.idx[c];
      this.idx[c] = clampI(old + d, 0, MAX_IDX);
      this.lastDelta[c] = this.idx[c] - old;
      this.history[c].push(this.price(c));
    }
    this.say(`Курсы раунда ${this.round}: Нова $${this.price('N')}, Атлас $${this.price('A')}.`);
  }

  // ---------- деньги ----------
  forcePay(p, amt) {
    if (amt <= 0) return;
    while (p.cash < amt) {
      const c = COIN_IDS.filter((x) => p.coins[x] > 0).sort((a, b) => p.coins[b] * this.price(b) - p.coins[a] * this.price(a))[0];
      if (!c) break;
      const q = Math.min(p.coins[c], Math.ceil((amt - p.cash) / this.price(c)));
      p.coins[c] -= q; p.cash += q * this.price(c);
      this.say(`${p.name} вынужден продать ${q} ${c === 'N' ? 'Новы' : 'Атласа'}.`);
    }
    while (p.cash < amt && p.cards.length) {
      p.cards.sort((a, b) => a.tier - b.tier);
      const c = p.cards.shift(); p.cash += CARDS[c.tier - 1].cost / 2;
      this.say(`${p.name} вынужден продать «${CARDS[c.tier - 1].name}».`);
    }
    if (p.cash >= amt) { p.cash -= amt; return; }
    const short = amt - p.cash; p.cash = 0; p.loans[20] += short;
    this.say(`${p.name} не хватило $${short}: долг вырос.`);
  }

  // ---------- раунд ----------
  startRound() {
    this.rollRates();
    if (Math.random() < 0.25) this.drawCrisis('Кризис раунда');
  }
  drawCrisis(who) {
    const c = pick(CRISES);
    this.crisis = { text: c.t, who };
    this.say(`⚠ ${c.t}`);
    c.fx(this);
  }

  endRound() {
    const parts = [];
    if (this.flags.noProfit) this.say('Блэкаут: добыча в этом раунде пропущена.');
    else {
      for (const p of this.players) {
        let elec = 0; const got = { N: 0, A: 0 };
        for (const c of p.cards) {
          if (c.coin === 'off') continue;
          const def = CARDS[c.tier - 1];
          let y = def.power; if (this.flags.halve) y = Math.max(1, Math.floor(y / 2));
          p.coins[c.coin] += y; got[c.coin] += y;
          elec += def.power * ELEC * (this.flags.elecX2 ? 2 : 1);
        }
        if (elec) this.forcePay(p, elec);
        if (got.N || got.A) parts.push(`${p.name}: +${got.N} Н, +${got.A} А, свет −$${elec}`);
      }
      if (parts.length) this.say('Добыча: ' + parts.join(' · '));
    }
    for (const p of this.players) {
      const interest = Math.round(p.loans[10] * LOANS[10].rate + p.loans[20] * LOANS[20].rate);
      if (interest) { this.say(`${p.name} платит проценты: $${interest}`); this.forcePay(p, interest); }
    }
    this.flags = {};
    this.round++;
    if (this.round > this.rounds) return this.finish();
    this.startRound();
  }

  finish() {
    if (this.finished) return;
    this.finished = true; this.phase = 'over'; this.auction = null; this.pending = null;
    this.say(`Игра окончена. Победитель: ${this.standings()[0].name}.`);
  }
  forceFinish() { this.finish(); }

  standings() {
    return this.players.map((p) => {
      const g = GOALS.find((x) => x.id === p.goal);
      const done = g.ok(p), worth = this.worth(p);
      return { id: p.id, name: p.name, isBot: p.isBot, color: p.color, worth, goal: g.text, done, bonus: done ? GOAL_BONUS : 0, score: worth + (done ? GOAL_BONUS : 0) };
    }).sort((a, b) => b.score - a.score);
  }

  // ---------- движение и клетки ----------
  landOn(p) {
    const cell = BOARD[p.pos];
    this.pending = null;
    const toMarket = () => { this.phase = 'market'; };
    switch (cell.type) {
      case 'work': p.cash += WORK_PAY; p.workStops++; this.say(`${p.name} работает: +$${WORK_PAY}.`); break;
      case 'shop':
        if (this.freeSlots(p) > 0 && p.cash >= CARDS[0].cost * SHOP_DISC) { this.phase = 'cell'; this.pending = { type: 'shop' }; this.say(`${p.name} в магазине карт (скидка 20%).`); return; }
        this.say(`${p.name} в магазине, но купить не может (нет слота или денег).`); break;
      case 'expand':
        if (p.slots < MAX_SLOTS && p.cash >= SLOT_COST) { this.phase = 'cell'; this.pending = { type: 'expand' }; this.say(`${p.name} может расширить ферму за $${SLOT_COST}.`); return; }
        this.say(`${p.name}: расширить ферму не получилось.`); break;
      case 'lottery':
        if (p.cash >= LOTTERY_FEE) { this.phase = 'cell'; this.pending = { type: 'lottery' }; this.say(`${p.name} у лотереи (билет $${LOTTERY_FEE}).`); return; }
        break;
      case 'auction': if (this.startAuction()) return; this.say('На аукцион некому ставить: нет свободных слотов.'); break;
      case 'crisis': this.drawCrisis(p.name); break;
      case 'strike': {
        const got = { N: 0, A: 0 };
        for (const c of p.cards) if (c.coin !== 'off') { const y = CARDS[c.tier - 1].power; p.coins[c.coin] += y; got[c.coin] += y; }
        this.say(`${p.name}: майнинг-рывок! +${got.N} Нова, +${got.A} Атлас без расходов на свет.`); break;
      }
      case 'reversal':
        for (const c of COIN_IDS) { const old = this.idx[c]; this.idx[c] = clampI(old - this.lastDelta[c], 0, MAX_IDX); this.lastDelta[c] = this.idx[c] - old; }
        this.say(`Разворот рынка! Нова $${this.price('N')}, Атлас $${this.price('A')}.`); break;
      case 'tax': { const s = 20 * p.cards.length; this.say(`${p.name} платит за свет: $${s}.`); this.forcePay(p, s); break; }
      case 'luck': p.luck = Math.min(MAX_LUCK, p.luck + 1); this.say(`${p.name} получает очко удачи.`); break;
      case 'hack': {
        const c = p.coins.N * this.price('N') >= p.coins.A * this.price('A') ? 'N' : 'A';
        if (p.coins[c] > 0) { p.coins[c]--; this.say(`Хакеры украли у ${p.name} 1 ${c === 'N' ? 'Нову' : 'Атлас'}!`); } else this.say(`Хакеры ничего не нашли у ${p.name}.`);
        break;
      }
      case 'boom': {
        const c = p.coins.N === p.coins.A ? pick(COIN_IDS) : (p.coins.N > p.coins.A ? 'N' : 'A');
        this.say(`${p.name}: биржевой бум!`); this.shift(c, 2); break;
      }
      case 'investor': { const s = 40 * p.cards.length; p.cash += s; this.say(`${p.name}: инвестор вложился, +$${s}.`); break; }
      default: break;
    }
    toMarket();
  }

  startAuction() {
    if (!this.players.some((p) => this.auctionEligible(p))) return false;
    const r = Math.random();
    const tier = r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
    this.auction = { tier, bids: {} };
    this.phase = 'auction';
    this.say(`Аукцион: «${CARDS[tier - 1].name}» (цена в магазине $${CARDS[tier - 1].cost}). Ставки тайные!`);
    return true;
  }
  auctionEligible(p) { return this.freeSlots(p) > 0 && p.cash > 0; }
  bid(p, arg) {
    if (this.phase !== 'auction' || !this.auction) return fail('Сейчас нет аукциона');
    if (!this.auctionEligible(p)) return fail('У тебя нет свободного слота или денег');
    if (this.auction.bids[p.id] !== undefined) return fail('Ты уже сделал ставку');
    const raw = typeof arg === 'object' && arg ? arg.amount : arg;
    const amount = Math.trunc(Number(raw));
    if (!Number.isFinite(amount) || amount < 0) return fail('Неверная ставка');
    if (amount > p.cash) return fail('Не хватает денег');
    this.auction.bids[p.id] = amount;
    if (this.players.filter((x) => this.auctionEligible(x)).every((x) => this.auction.bids[x.id] !== undefined)) this.resolveAuction();
    return OK;
  }
  resolveAuction() {
    const a = this.auction; if (!a) return;
    const n = this.players.length;
    let best = null;
    for (let k = 0; k < n; k++) { // при равных ставках выигрывает ближайший по порядку хода
      const p = this.players[(this.cur + k) % n];
      const b = a.bids[p.id];
      if (b > 0 && (!best || b > best.b)) best = { p, b };
    }
    if (best) {
      best.p.cash -= best.b;
      const coin = this.price('N') >= this.price('A') ? 'N' : 'A';
      best.p.cards.push({ id: this.cardSeq++, tier: a.tier, coin });
      this.say(`${best.p.name} выигрывает аукцион: «${CARDS[a.tier - 1].name}» за $${best.b}.`);
    } else this.say('Аукцион: никто не поставил, карта снята.');
    this.auction = null; this.phase = 'market';
  }

  // ---------- действия игрока ----------
  act(id, action, arg) {
    if (this.finished) return fail('Игра окончена');
    const p = this.player(id);
    if (!p) return fail('Ты не в игре');
    if (action === 'bid') return this.bid(p, arg);
    if (this.curPlayer().id !== id) return fail('Сейчас не твой ход');
    const o = typeof arg === 'object' && arg ? arg : { k: arg };
    switch (action) {
      case 'roll': {
        if (this.phase !== 'roll') return fail('Бросать сейчас нельзя');
        const a = die(), b = die();
        this.dice = [a, b]; this.seq++;
        const old = p.pos; p.pos = (old + a + b) % N_CELLS; p.anim = 'walk';
        this.say(`${p.name} бросает ${a} и ${b}.`);
        if (old + a + b >= N_CELLS) { p.cash += PASS_START; this.say(`${p.name} проходит СТАРТ: +$${PASS_START}.`); }
        this.landOn(p);
        return OK;
      }
      case 'skip':
        if (this.phase !== 'cell') return fail('Нечего пропускать');
        this.pending = null; this.phase = 'market'; return OK;
      case 'buyCard': {
        if (this.phase !== 'cell' || !this.pending || this.pending.type !== 'shop') return fail('Здесь нет магазина');
        const def = CARDS[Number(o.k) - 1]; if (!def) return fail('Нет такой карты');
        const cost = Math.round(def.cost * SHOP_DISC);
        if (this.freeSlots(p) <= 0) return fail('Нет свободного слота');
        if (p.cash < cost) return fail('Не хватает денег');
        p.cash -= cost;
        const coin = this.price('N') >= this.price('A') ? 'N' : 'A';
        p.cards.push({ id: this.cardSeq++, tier: def.tier, coin });
        this.say(`${p.name} покупает «${def.name}» за $${cost}.`);
        this.pending = null; this.phase = 'market'; return OK;
      }
      case 'buySlot':
        if (this.phase !== 'cell' || !this.pending || this.pending.type !== 'expand') return fail('Здесь нельзя расширяться');
        if (p.slots >= MAX_SLOTS) return fail('Ферма уже максимальная');
        if (p.cash < SLOT_COST) return fail('Не хватает денег');
        p.cash -= SLOT_COST; p.slots++;
        this.say(`${p.name} расширяет ферму: слотов ${p.slots}.`);
        this.pending = null; this.phase = 'market'; return OK;
      case 'playLottery': {
        if (this.phase !== 'cell' || !this.pending || this.pending.type !== 'lottery') return fail('Здесь нет лотереи');
        if (p.cash < LOTTERY_FEE) return fail('Не хватает денег');
        p.cash -= LOTTERY_FEE;
        const d = die(), prize = d <= 3 ? 0 : d === 4 ? 100 : d === 5 ? 200 : 400;
        p.cash += prize;
        this.say(`${p.name} играет в лотерею: выпало ${d}${prize ? `, выигрыш $${prize}` : ', ничего'}.`);
        this.pending = null; this.phase = 'market'; return OK;
      }
      case 'trade': {
        if (this.phase !== 'market') return fail('Торговать можно после клетки');
        const c = o.coin; if (!COIN_IDS.includes(c)) return fail('Неизвестная монета');
        const q = Math.trunc(Number(o.qty));
        if (!q || Math.abs(q) > 100) return fail('Неверное количество');
        const pr = this.price(c);
        if (q > 0) { if (p.cash < q * pr) return fail('Не хватает денег'); p.cash -= q * pr; p.coins[c] += q; }
        else { if (p.coins[c] < -q) return fail('Нет столько монет'); p.coins[c] += q; p.cash += -q * pr; }
        return OK;
      }
      case 'loan': {
        if (this.phase !== 'market') return fail('Кредит берут на этапе рынка');
        const k = Number(o.k); if (!LOANS[k]) return fail('Нет такого кредита');
        if (p.loans[k] > 0) return fail('Этот кредит уже взят');
        p.cash += LOANS[k].amount; p.loans[k] = LOANS[k].amount;
        this.say(`${p.name} берёт кредит $${LOANS[k].amount} под ${k}%.`); return OK;
      }
      case 'repay': {
        if (this.phase !== 'market') return fail('Погашать можно на этапе рынка');
        const k = Number(o.k); if (!LOANS[k] || p.loans[k] <= 0) return fail('Нечего гасить');
        if (p.cash < p.loans[k]) return fail('Не хватает денег');
        p.cash -= p.loans[k]; this.say(`${p.name} гасит кредит ${k}% ($${p.loans[k]}).`); p.loans[k] = 0; return OK;
      }
      case 'luck': {
        if (this.phase !== 'market') return fail('Удачу тратят на этапе рынка');
        const c = o.coin; if (!COIN_IDS.includes(c)) return fail('Неизвестная монета');
        const dir = Number(o.dir) > 0 ? 1 : -1;
        if (p.luck < 1) return fail('Нет очков удачи');
        if (p.luckUsed >= LUCK_PER_TURN) return fail(`За ход можно потратить максимум ${LUCK_PER_TURN} очка удачи`);
        p.luck--; p.luckUsed++;
        this.say(`${p.name} тратит удачу:`); this.shift(c, dir); return OK;
      }
      case 'assign': {
        if (this.phase !== 'market') return fail('Менять добычу можно на этапе рынка');
        const card = p.cards.find((c) => c.id === Number(o.id));
        if (!card) return fail('Нет такой карты');
        if (!['N', 'A', 'off'].includes(o.coin)) return fail('Неверный режим');
        card.coin = o.coin; return OK;
      }
      case 'endTurn': {
        if (this.phase !== 'market') return fail('Ход ещё не закончен');
        this.endTurn(p); return OK;
      }
      default: return fail('Неизвестное действие');
    }
  }

  endTurn(p) {
    p.luckUsed = 0; this.pending = null;
    this.cur++;
    if (this.cur >= this.players.length) { this.cur = 0; this.endRound(); if (this.finished) return; }
    this.phase = 'roll';
  }

  // ---------- тайм-аут человека и боты ----------
  autoStep() {
    const p = this.curPlayer();
    if (this.phase === 'roll') this.act(p.id, 'roll');
    else if (this.phase === 'cell') this.act(p.id, 'skip');
    else if (this.phase === 'market') this.act(p.id, 'endTurn');
    else if (this.phase === 'auction') this.resolveAuction();
  }

  botStep() {
    if (this.finished) return;
    if (this.phase === 'auction') {
      for (const p of this.players) {
        if (this.phase !== 'auction') return;
        if (p.isBot && this.auctionEligible(p) && this.auction.bids[p.id] === undefined) this.botBid(p);
      }
      return;
    }
    const p = this.curPlayer(), id = p.id;
    if (this.phase === 'roll') this.act(id, 'roll');
    else if (this.phase === 'cell') this.botCell(p);
    else if (this.phase === 'market') { this.botMarket(p); this.act(id, 'endTurn'); }
  }

  botBid(p) {
    const cost = CARDS[this.auction.tier - 1].cost;
    let amount = Math.round(cost * (0.35 + Math.random() * 0.4));
    amount = Math.min(amount, p.cash - 100);
    if (amount < 20) amount = 0;
    this.act(p.id, 'bid', { amount });
  }

  botCell(p) {
    const id = p.id, t = this.pending && this.pending.type;
    if (t === 'shop') {
      for (const tier of [3, 2, 1]) {
        const cost = Math.round(CARDS[tier - 1].cost * SHOP_DISC);
        if (p.cash - cost >= 150 && this.act(id, 'buyCard', { k: tier }).ok) return;
      }
      this.act(id, 'skip');
    } else if (t === 'expand') {
      if (p.cash >= SLOT_COST + 250 && this.freeSlots(p) < 1) this.act(id, 'buySlot'); else this.act(id, 'skip');
    } else if (t === 'lottery') {
      this.act(id, p.cash >= 300 ? 'playLottery' : 'skip');
    } else this.act(id, 'skip');
  }

  botMarket(p) {
    const id = p.id;
    for (const c of p.cards) {
      let best = this.price('N') >= this.price('A') ? 'N' : 'A';
      if (this.price(best) <= ELEC + 5) best = 'off'; // добыча не окупает электричество
      if (c.coin !== best) this.act(id, 'assign', { id: c.id, coin: best });
    }
    for (const c of COIN_IDS) {
      const idx = this.idx[c], pr = this.price(c);
      const buyAt = c === 'N' ? 3 : 2;
      if (idx >= 7 && p.coins[c] > 0) this.act(id, 'trade', { coin: c, qty: -p.coins[c] });
      else if (idx <= buyAt && this.round < this.rounds - 1) {
        const q = Math.floor(Math.max(0, p.cash - 250) * 0.5 / pr);
        if (q > 0) this.act(id, 'trade', { coin: c, qty: q });
      }
    }
    if (p.luck > 0 && Math.random() < 0.5) {
      const c = p.coins.N * this.price('N') >= p.coins.A * this.price('A') ? 'N' : 'A';
      if (p.coins[c] > 0) this.act(id, 'luck', { coin: c, dir: 1 });
    }
    if (p.cash < 150 && this.freeSlots(p) > 0 && p.loans[10] === 0 && this.round < this.rounds - 2) this.act(id, 'loan', { k: 10 });
    if (p.loans[20] > 0 && p.cash > 1300) this.act(id, 'repay', { k: 20 });
    if (p.loans[10] > 0 && p.cash > 900) this.act(id, 'repay', { k: 10 });
    if (this.round >= this.rounds - 1) { for (const k of [20, 10]) if (p.loans[k] > 0 && p.cash >= p.loans[k]) this.act(id, 'repay', { k }); }
  }

  // ---------- вид для клиента ----------
  view(forId) {
    const cp = this.curPlayer();
    const rate = (c) => ({ idx: this.idx[c], price: this.price(c), delta: this.lastDelta[c] });
    return {
      round: Math.min(this.round, this.rounds), rounds: this.rounds, phase: this.phase, cur: cp.id,
      pending: this.pending, dice: this.dice, seq: this.seq,
      auction: this.auction && {
        tier: this.auction.tier,
        bids: Object.fromEntries(Object.keys(this.auction.bids).map((k) => [k, true])),
        eligible: this.players.filter((p) => this.auctionEligible(p)).map((p) => p.id),
      },
      rates: { N: rate('N'), A: rate('A') },
      history: { N: this.history.N.slice(-14), A: this.history.A.slice(-14) },
      crisis: this.crisis, flags: this.flags, log: this.log.slice(-16),
      players: this.players.map((p) => {
        const g = GOALS.find((x) => x.id === p.goal);
        return {
          id: p.id, name: p.name, isBot: p.isBot, color: p.color, cash: p.cash, coins: p.coins, slots: p.slots,
          cards: p.cards, luck: p.luck, luckUsed: p.luckUsed, loans: p.loans, pos: p.pos, worth: this.worth(p),
          goal: p.id === forId || this.finished ? { text: g.text, done: g.ok(p) } : null,
        };
      }),
      finished: this.finished, standings: this.finished ? this.standings() : null,
    };
  }
}

const STATIC = {
  board: BOARD, coins: COINS.map(({ id, name, color, prices }) => ({ id, name, color, prices })), cards: CARDS, loans: LOANS,
  consts: { SLOT_COST, MAX_SLOTS, SHOP_DISC, ELEC, LOTTERY_FEE, GOAL_BONUS, LUCK_PER_TURN },
};
module.exports = { Game, STATIC, BOARD, CARDS, COINS, SLOT_COST, MAX_SLOTS, SHOP_DISC };
