'use strict';
// Block Barons — настольная игра: логика (оригинальные клетки, цены и карточки)

const GROUP_COLORS = { g1: '#8b5cf6', g2: '#38bdf8', g3: '#f472b6', g4: '#fb923c', g5: '#ef4444', g6: '#facc15', g7: '#22c55e', g8: '#3b82f6' };

const P = (name, g, price) => ({ type: 'prop', name, g, price });
const SQ = [
  { type: 'start', name: 'СТАРТ' },
  P('Пиксель-аллея', 'g1', 60), { type: 'fund', name: 'Фонд' }, P('Токен-стрит', 'g1', 60),
  { type: 'tax', name: 'Комиссия сети', amount: 200 },
  { type: 'exch', name: 'Биржа Север', price: 200 },
  P('Хеш-сквер', 'g2', 100), { type: 'event', name: 'Событие' }, P('Нод-бульвар', 'g2', 100), P('Блок-лейн', 'g2', 120),
  { type: 'jail', name: 'Блокировка' },
  P('Леджер-плаза', 'g3', 140), { type: 'util', name: 'Майнинг-ферма', price: 150 }, P('Стейк-роу', 'g3', 140), P('Валлет-парк', 'g3', 160),
  { type: 'exch', name: 'Биржа Восток', price: 200 },
  P('Смарт-авеню', 'g4', 180), { type: 'fund', name: 'Фонд' }, P('Газ-стрит', 'g4', 180), P('Форк-мост', 'g4', 200),
  { type: 'park', name: 'Холодный кошелёк' },
  P('Аирдроп-сити', 'g5', 220), { type: 'event', name: 'Событие' }, P('Дефай-холл', 'g5', 220), P('Минт-порт', 'g5', 240),
  { type: 'exch', name: 'Биржа Юг', price: 200 },
  P('Орбит-тауэр', 'g6', 260), P('Нейро-парк', 'g6', 260), { type: 'util', name: 'Дата-центр', price: 150 }, P('Квант-холл', 'g6', 280),
  { type: 'gojail', name: 'Бан биржи' },
  P('Генезис-бульвар', 'g7', 300), P('Сатоши-сквер', 'g7', 300), { type: 'fund', name: 'Фонд' }, P('Вэйв-авеню', 'g7', 320),
  { type: 'exch', name: 'Биржа Запад', price: 200 },
  { type: 'event', name: 'Событие' }, P('Барон-плаза', 'g8', 350),
  { type: 'tax', name: 'Налог на майнинг', amount: 100 },
  P('Блок-тауэр', 'g8', 400),
];
SQ.forEach((s, i) => {
  s.i = i;
  if (s.type === 'prop') {
    const b = Math.floor(s.price / 30);
    s.rents = [b, 5 * b, 15 * b, 45 * b, 80 * b, 125 * b];
    s.cost = Math.round((s.price * 0.8) / 10) * 10;
    s.color = GROUP_COLORS[s.g];
  }
});
const GROUPS = {};
SQ.forEach((s) => { if (s.type === 'prop') (GROUPS[s.g] = GROUPS[s.g] || []).push(s.i); });

const EVENT_CARDS = [
  { t: 'Рынок взлетел! Получи $150', gain: 150 },
  { t: 'Налоговая проверка: заплати $100', pay: 100 },
  { t: 'Отправляйся на СТАРТ', moveTo: 0 },
  { t: 'Бан биржи: отправляйся в Блокировку', jail: true },
  { t: 'Откат сети: отступи на 3 клетки', moveBy: -3 },
  { t: 'Карта «Выход из Блокировки»', jailFree: true },
  { t: 'Хард-форк: ремонт ферм, $25 за дом и $100 за отель', repairs: [25, 100] },
  { t: 'Отправляйся на Блок-тауэр', moveTo: 39 },
  { t: 'Вывод стейкинга: получи $50', gain: 50 },
  { t: 'Штраф за газ: заплати $60', pay: 60 },
];
const FUND_CARDS = [
  { t: 'Дивиденды фонда: получи $100', gain: 100 },
  { t: 'День рождения: получи по $20 с каждого игрока', collectEach: 20 },
  { t: 'Взнос в фонд: заплати каждому игроку по $25', payEach: 25 },
  { t: 'Возврат комиссий: получи $40', gain: 40 },
  { t: 'Лечение серверов: заплати $80', pay: 80 },
  { t: 'Отправляйся на Пиксель-аллею', moveTo: 1 },
  { t: 'Карта «Выход из Блокировки»', jailFree: true },
  { t: 'Аудит: заплати $50', pay: 50 },
  { t: 'Грант разработчику: получи $200', gain: 200 },
  { t: 'Ошибка в кошельке: заплати $30', pay: 30 },
];

const PASS_START = 200;
const JAIL_FEE = 50;
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const die = () => 1 + rnd(6);

class Game {
  constructor(opts) {
    this.startCash = opts.startCash || 1500;
    this.turnLimit = opts.turnLimit || 20;
    this.players = opts.players.map((p, i) => ({
      id: p.id, name: p.name, isBot: !!p.isBot, human: !p.isBot, color: i,
      cash: this.startCash, pos: 0, jail: 0, jailCards: 0, bankrupt: false, doubles: 0, anim: 'jump',
    }));
    this.owner = Array(40).fill(null);
    this.lvl = Array(40).fill(0);
    this.cur = 0;
    this.round = 1;
    this.phase = 'roll'; // roll | buy | end
    this.again = false;
    this.pending = null;
    this.dice = [0, 0];
    this.seq = 0; // растёт при каждом броске (для анимации кубиков)
    this.pot = 0;
    this.card = null; // последняя вытянутая карточка
    this.log = [];
    this.finished = false;
    this.say(`Игра началась! Ходит ${this.players[0].name}.`);
  }

  say(t) { this.log.push(t); if (this.log.length > 40) this.log.shift(); }
  curPlayer() { return this.players[this.cur]; }
  player(id) { return this.players.find((p) => p.id === id); }
  alive() { return this.players.filter((p) => !p.bankrupt); }
  ownedBy(p) { return SQ.filter((s) => this.owner[s.i] === p.id); }

  worth(p) {
    if (p.bankrupt) return 0;
    let w = p.cash;
    for (const s of this.ownedBy(p)) { w += s.price; if (s.type === 'prop') w += this.lvl[s.i] * s.cost; }
    return w;
  }

  // ---------- аренда ----------
  rentFor(s, diceTotal) {
    const ow = this.owner[s.i];
    if (s.type === 'prop') {
      const l = this.lvl[s.i];
      let r = s.rents[l];
      if (l === 0 && GROUPS[s.g].every((i) => this.owner[i] === ow)) r *= 2;
      return r;
    }
    if (s.type === 'exch') {
      const n = SQ.filter((x) => x.type === 'exch' && this.owner[x.i] === ow).length;
      return 25 * 2 ** (n - 1);
    }
    const n = SQ.filter((x) => x.type === 'util' && this.owner[x.i] === ow).length;
    return diceTotal * (n === 2 ? 10 : 4);
  }

  // ---------- деньги ----------
  // Платёж: сначала наличные, затем автоматическая продажа домов; иначе банкротство.
  pay(p, amount, to) {
    if (amount <= 0) return true;
    while (p.cash < amount) {
      const houses = this.ownedBy(p).filter((s) => s.type === 'prop' && this.lvl[s.i] > 0).sort((a, b) => this.lvl[b.i] - this.lvl[a.i]);
      if (!houses.length) break;
      const s = houses[0]; this.lvl[s.i]--; p.cash += Math.floor(s.cost / 2);
    }
    if (p.cash >= amount) {
      p.cash -= amount;
      if (to) to.cash += amount;
      return true;
    }
    this.goBankrupt(p, to);
    return false;
  }

  goBankrupt(p, to) {
    this.say(`${p.name} обанкротился!`);
    if (to) { to.cash += Math.max(0, p.cash); }
    p.cash = 0; p.bankrupt = true;
    for (const s of this.ownedBy(p)) { this.owner[s.i] = to ? to.id : null; this.lvl[s.i] = 0; }
    this.checkWinner();
  }

  checkWinner() {
    if (this.alive().length <= 1) { this.finish(); return true; }
    return false;
  }

  finish() {
    if (this.finished) return;
    this.finished = true; this.phase = 'over';
    const st = this.standings();
    this.say(`Игра окончена. Победитель: ${st[0].name}.`);
  }
  forceFinish() { this.finish(); }

  standings() {
    return this.players
      .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, worth: this.worth(p), bankrupt: p.bankrupt, color: p.color }))
      .sort((a, b) => b.worth - a.worth);
  }

  // ---------- движение ----------
  advance(p, steps, anim) {
    const old = p.pos;
    p.pos = (old + steps) % 40;
    p.anim = anim;
    if (old + steps >= 40) { p.cash += PASS_START; this.say(`${p.name} проходит СТАРТ: +$${PASS_START}`); }
  }
  jumpTo(p, idx, collect) {
    if (collect && idx < p.pos) { p.cash += PASS_START; this.say(`${p.name} проходит СТАРТ: +$${PASS_START}`); }
    p.pos = idx; p.anim = 'jump';
  }
  sendJail(p) {
    p.pos = 10; p.jail = 3; p.anim = 'jump'; p.doubles = 0; this.again = false;
    this.say(`${p.name} попадает в Блокировку.`);
  }

  landOn(p) {
    const s = SQ[p.pos];
    const total = this.dice[0] + this.dice[1];
    this.pending = null;
    switch (s.type) {
      case 'prop': case 'exch': case 'util': {
        const ow = this.owner[s.i];
        if (ow === null) {
          if (p.cash >= s.price) { this.phase = 'buy'; this.pending = s.i; this.say(`${p.name} на клетке «${s.name}» ($${s.price}).`); return; }
          this.say(`${p.name} на клетке «${s.name}», но денег не хватает.`);
        } else if (ow !== p.id) {
          const owner = this.player(ow);
          if (!owner.bankrupt) {
            const r = this.rentFor(s, total);
            this.say(`${p.name} платит ${owner.name} аренду $${r} («${s.name}»).`);
            this.pay(p, r, owner);
          }
        }
        break;
      }
      case 'tax': this.say(`${p.name} платит «${s.name}»: $${s.amount}.`); if (this.pay(p, s.amount, null)) this.pot += s.amount; break;
      case 'park': if (this.pot > 0) { this.say(`${p.name} забирает банк «Холодного кошелька»: +$${this.pot}.`); p.cash += this.pot; this.pot = 0; } else this.say(`${p.name} отдыхает в Холодном кошельке.`); break;
      case 'gojail': this.sendJail(p); break;
      case 'event': case 'fund': this.drawCard(p, s.type); return;
      default: break;
    }
    if (!this.finished && this.phase !== 'buy') this.phase = 'end';
  }

  drawCard(p, kind) {
    const c = pick(kind === 'event' ? EVENT_CARDS : FUND_CARDS);
    this.card = { kind, text: c.t, who: p.name };
    this.say(`${p.name}: «${c.t}»`);
    const others = this.alive().filter((x) => x.id !== p.id);
    if (c.gain) p.cash += c.gain;
    else if (c.pay) { if (this.pay(p, c.pay, null)) this.pot += c.pay; }
    else if (c.collectEach) { for (const o of others) { if (this.pay(o, c.collectEach, p) === false && this.finished) return; } }
    else if (c.payEach) { for (const o of others) { if (!this.pay(p, c.payEach, o)) break; } }
    else if (c.jailFree) p.jailCards++;
    else if (c.jail) this.sendJail(p);
    else if (c.repairs) {
      let sum = 0;
      for (const s of this.ownedBy(p)) if (s.type === 'prop') { const l = this.lvl[s.i]; sum += l === 5 ? c.repairs[1] : l * c.repairs[0]; }
      if (sum) this.pay(p, sum, null);
    } else if (c.moveTo !== undefined) { this.jumpTo(p, c.moveTo, true); this.landOn(p); return; }
    else if (c.moveBy) { const to = (p.pos + 40 + c.moveBy) % 40; this.jumpTo(p, to, false); this.landOn(p); return; }
    if (!this.finished && !p.bankrupt && this.phase !== 'buy') this.phase = 'end';
    if (p.bankrupt && !this.finished) { this.phase = 'end'; this.again = false; }
  }

  // ---------- действия игрока ----------
  act(id, action, arg) {
    const res = this._act(id, action, arg);
    // если игрок разорился в свой ход, ход сразу переходит дальше
    let guard = 0;
    while (!this.finished && this.curPlayer().bankrupt && guard++ < 10) { this.again = false; this.pending = null; this.endTurn(this.curPlayer()); }
    return res;
  }

  _act(id, action, arg) {
    if (this.finished) return { ok: false, err: 'Игра окончена' };
    const p = this.player(id);
    if (!p || p.bankrupt) return { ok: false, err: 'Ты не в игре' };
    if (this.curPlayer().id !== id) return { ok: false, err: 'Сейчас не твой ход' };
    const fail = (err) => ({ ok: false, err });
    switch (action) {
      case 'roll': {
        if (this.phase !== 'roll') return fail('Бросать сейчас нельзя');
        this.doRoll(p); return { ok: true };
      }
      case 'buy': {
        if (this.phase !== 'buy') return fail('Нечего покупать');
        const s = SQ[this.pending];
        if (p.cash < s.price) return fail('Не хватает денег');
        p.cash -= s.price; this.owner[s.i] = p.id; this.pending = null; this.phase = 'end';
        this.say(`${p.name} покупает «${s.name}» за $${s.price}.`); return { ok: true };
      }
      case 'decline': {
        if (this.phase !== 'buy') return fail('Нечего покупать');
        this.say(`${p.name} отказывается от покупки.`); this.pending = null; this.phase = 'end'; return { ok: true };
      }
      case 'endTurn': {
        if (this.phase !== 'end') return fail('Ход ещё не закончен');
        this.endTurn(p); return { ok: true };
      }
      case 'payJail': {
        if (this.phase !== 'roll' || p.jail <= 0) return fail('Ты не в Блокировке');
        if (p.cash < JAIL_FEE) return fail('Не хватает денег');
        p.cash -= JAIL_FEE; this.pot += JAIL_FEE; p.jail = 0; this.say(`${p.name} платит $${JAIL_FEE} и выходит из Блокировки.`); return { ok: true };
      }
      case 'useCard': {
        if (this.phase !== 'roll' || p.jail <= 0 || p.jailCards <= 0) return fail('Нельзя использовать карту');
        p.jailCards--; p.jail = 0; this.say(`${p.name} использует карту и выходит из Блокировки.`); return { ok: true };
      }
      case 'build': {
        if (this.phase === 'buy') return fail('Сначала реши с покупкой');
        const r = this.canBuild(p, arg); if (r !== true) return fail(r);
        const s = SQ[arg]; p.cash -= s.cost; this.lvl[arg]++;
        this.say(`${p.name} строит на «${s.name}» (уровень ${this.lvl[arg]}).`); return { ok: true };
      }
      case 'sell': {
        if (this.phase === 'buy') return fail('Сначала реши с покупкой');
        const s = SQ[arg];
        if (!s || s.type !== 'prop' || this.owner[arg] !== p.id || this.lvl[arg] <= 0) return fail('Нечего продавать');
        const max = Math.max(...GROUPS[s.g].map((i) => this.lvl[i]));
        if (this.lvl[arg] < max) return fail('Продавай сначала с самой застроенной улицы группы');
        this.lvl[arg]--; p.cash += Math.floor(s.cost / 2);
        this.say(`${p.name} продаёт строение на «${s.name}».`); return { ok: true };
      }
      default: return fail('Неизвестное действие');
    }
  }

  canBuild(p, idx) {
    const s = SQ[idx];
    if (!s || s.type !== 'prop') return 'Тут нельзя строить';
    if (this.owner[idx] !== p.id) return 'Это не твоя улица';
    if (!GROUPS[s.g].every((i) => this.owner[i] === p.id)) return 'Нужна вся цветовая группа';
    if (this.lvl[idx] >= 5) return 'Уже максимум';
    const min = Math.min(...GROUPS[s.g].map((i) => this.lvl[i]));
    if (this.lvl[idx] > min) return 'Строй равномерно по группе';
    if (p.cash < s.cost) return 'Не хватает денег';
    return true;
  }

  doRoll(p) {
    const a = die(), b = die(), total = a + b;
    this.dice = [a, b]; this.seq++;
    const dbl = a === b;
    this.say(`${p.name} бросает ${a} и ${b}.`);
    if (p.jail > 0) {
      if (dbl) { p.jail = 0; this.say(`${p.name} выбросил дубль и выходит из Блокировки.`); this.again = false; }
      else {
        p.jail--;
        if (p.jail > 0) { this.say(`${p.name} остаётся в Блокировке.`); this.phase = 'end'; this.again = false; return; }
        this.say(`${p.name} платит $${JAIL_FEE} за выход.`);
        if (!this.pay(p, JAIL_FEE, null)) { this.phase = 'end'; return; }
        this.pot += JAIL_FEE; this.again = false;
      }
      this.advance(p, total, 'walk'); this.landOn(p); return;
    }
    if (dbl) {
      p.doubles++;
      if (p.doubles >= 3) { this.say(`${p.name}: три дубля подряд!`); this.sendJail(p); this.phase = 'end'; return; }
      this.again = true;
    } else { p.doubles = 0; this.again = false; }
    this.advance(p, total, 'walk');
    this.landOn(p);
  }

  endTurn(p) {
    if (this.again && !p.bankrupt && p.jail === 0) { this.again = false; this.phase = 'roll'; this.say(`${p.name} ходит ещё раз (дубль).`); return; }
    p.doubles = 0; this.again = false;
    const n = this.players.length;
    let next = this.cur;
    do { next = (next + 1) % n; } while (this.players[next].bankrupt);
    if (next <= this.cur) {
      this.round++;
      if (this.round > this.turnLimit) { this.cur = next; this.finish(); return; }
    }
    this.cur = next; this.phase = 'roll'; this.pending = null;
  }

  // ---------- боты и тайм-ауты ----------
  autoStep() {
    const p = this.curPlayer();
    if (this.phase === 'roll') this.act(p.id, 'roll');
    else if (this.phase === 'buy') this.act(p.id, 'decline');
    else if (this.phase === 'end') this.act(p.id, 'endTurn');
  }

  botStep() {
    const p = this.curPlayer();
    if (this.finished || p.bankrupt) return;
    const id = p.id;
    if (this.phase === 'roll') {
      if (p.jail > 0) {
        if (p.jailCards > 0) { this.act(id, 'useCard'); return; }
        if (p.cash > 400 && this.round < this.turnLimit - 2) { this.act(id, 'payJail'); return; }
      }
      if (this.botBuild(p)) return;
      this.act(id, 'roll');
    } else if (this.phase === 'buy') {
      const s = SQ[this.pending];
      const reserve = this.round < 3 ? 60 : 120;
      this.act(id, p.cash - s.price >= reserve ? 'buy' : 'decline');
    } else if (this.phase === 'end') {
      if (this.botBuild(p)) return;
      this.act(id, 'endTurn');
    }
  }

  botBuild(p) {
    const cand = this.ownedBy(p).filter((s) => s.type === 'prop' && this.canBuild(p, s.i) === true && p.cash - s.cost >= 250)
      .sort((a, b) => this.lvl[a.i] - this.lvl[b.i]);
    if (!cand.length) return false;
    return this.act(p.id, 'build', cand[0].i).ok;
  }

  view() {
    const cp = this.curPlayer();
    return {
      round: Math.min(this.round, this.turnLimit), turnLimit: this.turnLimit,
      phase: this.phase, cur: cp.id, again: this.again, pending: this.pending,
      dice: this.dice, seq: this.seq, pot: this.pot, card: this.card,
      owner: this.owner, lvl: this.lvl, log: this.log.slice(-14),
      players: this.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, color: p.color, cash: p.cash, pos: p.pos, jail: p.jail,
        jailCards: p.jailCards, bankrupt: p.bankrupt, anim: p.anim, worth: this.worth(p),
      })),
      finished: this.finished, standings: this.finished ? this.standings() : null,
    };
  }
}

const BOARD = SQ.map((s) => ({ i: s.i, type: s.type, name: s.name, price: s.price, g: s.g, color: s.color, rents: s.rents, cost: s.cost, amount: s.amount }));
module.exports = { Game, BOARD, GROUP_COLORS, GROUPS, SQ };
