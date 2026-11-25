/* tests-engine.js — Node-tests voor shared/game-engine.js (engine/UI-scheiding, 2026-11-25).

   Gebruik (vanuit de map development):   node tests-engine.js

   Laadt shared/card-data.js, game-rules.js, game-mechanics.js en game-engine.js in één gedeelde scope
   (zoals de browser met <script>-tags) en draait de engine tegen een nep-omgeving: een arena-state in het
   geheugen en tellers voor save()/render(). Er is geen DOM en geen popup nodig. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function tests(){
  let passed = 0, failed = 0;
  function ok(cond, name){ if (cond){ passed++; } else { failed++; console.log("FAIL: " + name); } }
  function eq(a, b, name){ ok(JSON.stringify(a) === JSON.stringify(b), name + " (kreeg " + JSON.stringify(a) + ", verwachtte " + JSON.stringify(b) + ")"); }

  const ALL_ON = { autoPayCost: true, enforceCastLegality: true, resolveEnabled: true, turnRedux: true, resolveEffects: true,
    burdenDiscardStack: true, discardEffects: true, restEffects: true, inflictEffects: true, directEffects: true, turnEffects: true,
    playedEffects: true, abilityEffects: true, enterPlayEffects: true, cardEffects: true, reactiveEffects: true };
  const mkPlayer = (name) => ({ name: name, counters: { actions: 3, spite: 0, bodyStat: 3, mindStat: 3, soulStat: 3, bodyShield: 0, mindShield: 0, soulShield: 0 },
    deck: [], hand: [], inPlayBody: [], inPlayMind: [], inPlaySoul: [], discard: [], banished: [] });
  const mkCi = (id, cardId, o) => Object.assign({ instanceId: id, cardId: cardId || id, tapped: false, counters: freshCounters() }, o || {});
  const eff = (o) => normalizeEffect(o);

  // Nieuwe omgeving: cards = { id: kaartdata }
  function setup(cards, settings){
    const arena = { players: [mkPlayer("A"), mkPlayer("B")], stack: [], log: [], settings: Object.assign({}, ALL_ON, settings || {}) };
    const counts = { save: 0, render: 0 };
    const env = { getArena: () => arena, findCard: (id) => cards[id], ensureSettings(){}, save(){ counts.save++; }, render(){ counts.render++; } };
    return { arena, counts, E: createGameEngine(env) };
  }
  const logHas = (arena, txt) => arena.log.some(l => l.text.includes(txt));
  const manif = (o) => Object.assign({ id: "m", type: "Manifestation", name: "Muur", body: 2, mind: 1, soul: 1, slumber: 0, effects: [] }, o || {});

  // ---- live arena: de engine leest de state via getArena, ook als die vervangen wordt ----
  {
    let current = { players: [mkPlayer("A"), mkPlayer("B")], stack: [], log: [], settings: Object.assign({}, ALL_ON) };
    const E = createGameEngine({ getArena: () => current, findCard: () => undefined, ensureSettings(){}, save(){}, render(){} });
    E.logAction("een", "misc");
    const other = { players: [mkPlayer("C"), mkPlayer("D")], stack: [], log: [], settings: {} };
    current = other;
    E.logAction("twee", "misc");
    eq(other.log.length, 1, "live: log komt in de vervangen arena terecht");
    ok(E.getZoneArray(0, "hand") === other.players[0].hand, "live: zone-array uit de nieuwe arena");
  }

  // ---- silent: addCounterToInstance ----
  {
    const { arena, counts, E } = setup({ m: manif({ body: 3 }) });
    const ci = mkCi("i1", "m"); arena.players[0].inPlayBody.push(ci);
    E.addCounterToInstance(0, "inPlayBody", "i1", "black", { auto: true, silent: true });
    eq(ci.counters.black, 1, "counter silent: teller +1");
    eq(counts, { save: 0, render: 0 }, "counter silent: geen save/render");
    E.addCounterToInstance(0, "inPlayBody", "i1", "black");
    eq(ci.counters.black, 2, "counter normaal: teller +1");
    eq(counts, { save: 1, render: 1 }, "counter normaal: wel save/render");
  }

  // ---- permanente schade: dood via effect, silent en niet-silent ----
  {
    const { arena, counts, E } = setup({ m: manif({ body: 1 }) });
    const ci = mkCi("i1", "m"); arena.players[0].inPlayBody.push(ci);
    E.addCounterToInstance(0, "inPlayBody", "i1", "black", { auto: true, silent: true });   // teller 1 = Vulnerable
    E.addCounterToInstance(0, "inPlayBody", "i1", "black", { auto: true, silent: true });   // volgende schade = dood
    eq(arena.players[0].inPlayBody.length, 0, "dood: kaart uit play");
    eq(arena.players[0].discard.map(x => x.instanceId), ["i1"], "dood: kaart in discard");
    ok(logHas(arena, "sterft"), "dood: logregel");
    eq(counts, { save: 0, render: 0 }, "dood silent: geen save/render");
    const t = setup({ m: manif({ body: 1 }) });
    t.arena.players[0].inPlayBody.push(mkCi("i1", "m"));
    t.E.addCounterToInstance(0, "inPlayBody", "i1", "black", { auto: true });
    t.E.addCounterToInstance(0, "inPlayBody", "i1", "black", { auto: true });
    eq(t.arena.players[0].discard.length, 1, "dood normaal: in discard");
    ok(t.counts.save >= 1, "dood normaal: er is opgeslagen");
  }

  // ---- pushDamageToStack / pushInflictToStack: silent ----
  {
    const { arena, counts, E } = setup({});
    E.pushDamageToStack({ casterIdx: 0, targetIdx: 1, damageType: "body", amount: 2, sourceLabel: "Bliksem", silent: true });
    eq(counts.save, 0, "damage silent: geen save");
    const d = arena.stack[0];
    ok(d.isDamage && d.targetIdx === 1 && d.damageType === "body" && d.amount === 2 && d.baseAmount === 2 && d.priorityWith === 1, "damage: entry-vorm");
    E.pushDamageToStack({ casterIdx: 0, targetIdx: 1, damageType: "mind", amount: -4 });
    eq(counts.save, 1, "damage normaal: save");
    eq(arena.stack[1].amount, 0, "damage: negatief aantal = 0");
    E.pushInflictToStack({ casterIdx: 0, targetIdx: 1, burdenCardId: "b", amount: 2, sourceLabel: "Vloek", silent: true });
    eq(counts.save, 1, "inflict silent: geen extra save");
    ok(arena.stack[2].isInflict && arena.stack[2].priorityWith === 1, "inflict: entry-vorm");
  }

  // ---- fire*-dispatchers: effecten slaan niet zelf op ----
  {
    const spell = { id: "s", type: "Incantation", name: "Vuurbal", effects: [
      eff({ kind: "trigger", trigger: "OnResolve", action: "Damage", target: "opponent", damageType: "body", value: 2 }),
      eff({ kind: "trigger", trigger: "OnResolve", action: "Draw", target: "controller", value: 1 })
    ] };
    const { arena, counts, E } = setup({ s: spell });
    arena.players[0].deck.push(mkCi("d1", "s"));
    E.fireOnResolveEffects(spell, 0, null, null);
    eq(arena.players[0].hand.length, 1, "OnResolve: Draw direct uitgevoerd");
    eq(arena.stack.length, 1, "OnResolve: Damage-entry op de stack");
    eq(arena.stack[0].targetIdx, 1, "OnResolve: doelwit = tegenstander");
    eq(counts, { save: 0, render: 0 }, "OnResolve: de dispatcher slaat zelf niet op");
    const off = setup({ s: spell }, { resolveEffects: false });
    off.E.fireOnResolveEffects(spell, 0, null, null);
    eq(off.arena.stack.length, 0, "OnResolve: instelling uit = niets");
  }
  {
    const pig = { id: "p", type: "Manifestation", name: "Varken", body: 1, mind: 1, soul: 1, effects: [
      eff({ kind: "trigger", trigger: "OnEnterPlay", action: "Exhaust", target: "self" })
    ] };
    const { arena, counts, E } = setup({ p: pig });
    const ci = mkCi("i1", "p"); arena.players[0].inPlayBody.push(ci);
    E.fireEnterPlayEffects(pig, 0, { playerIdx: 0, zone: "inPlayBody", instanceId: "i1" });
    ok(ci.tapped, "OnEnterPlay: Exhaust self toegepast");
    eq(counts, { save: 0, render: 0 }, "OnEnterPlay: geen save/render van de dispatcher");
  }
  {
    const hex = { id: "h", type: "Hex", name: "Pijl", effects: [
      eff({ kind: "trigger", trigger: "OnResolve", action: "Damage", target: "chosen", value: 2 })
    ] };
    const { arena, counts, E } = setup({ h: hex, m: manif({ body: 5 }) });
    const ci = mkCi("t1", "m"); arena.players[1].inPlayBody.push(ci);
    E.fireOnResolveEffects(hex, 0, { kind: "card", playerIdx: 1, zone: "inPlayBody", instanceId: "t1" }, null);
    eq(ci.counters.black, 2, "chosen: twee zwarte tellers op de gekozen kaart");
    eq(counts, { save: 0, render: 0 }, "chosen: geen save/render per teller");
  }

  // ---- takeStackDamage: wie mag het nemen ----
  {
    const { arena, counts, E } = setup({ c1: { id: "c1", name: "K1" }, c2: { id: "c2", name: "K2" }, c3: { id: "c3", name: "K3" } });
    arena.players[1].deck.push(mkCi("k1", "c1"), mkCi("k2", "c2"), mkCi("k3", "c3"));
    E.pushDamageToStack({ casterIdx: 0, targetIdx: 1, damageType: "body", amount: 2, silent: true });
    const id = arena.stack[0].instanceId;
    E.takeStackDamage(0, id);
    eq(arena.stack.length, 1, "take: speler 0 mag de schade van speler 1 niet nemen");
    E.takeStackDamage(1, id);
    eq(arena.stack.length, 0, "take: het doelwit mag wel");
    eq(arena.players[1].banished.length, 2, "take: 2 kaarten gebanisht (Body = top van het deck)");
    eq(arena.players[1].deck.length, 1, "take: 1 kaart over");
    ok(counts.save >= 1, "take: opgeslagen");
    const solo = setup({});
    solo.E.pushDamageToStack({ casterIdx: 0, targetIdx: 1, damageType: "body", amount: 0, silent: true });
    solo.E.takeStackDamage(null, solo.arena.stack[0].instanceId);
    eq(solo.arena.stack.length, 0, "take: acting null (solo) = geen restrictie");
    const noRes = setup({}, { resolveEnabled: false });
    noRes.E.pushDamageToStack({ casterIdx: 0, targetIdx: 1, damageType: "body", amount: 0, silent: true });
    noRes.E.takeStackDamage(1, noRes.arena.stack[0].instanceId);
    eq(noRes.arena.stack.length, 1, "take: Resolve uit = niets");
  }

  // ---- attackWithMinion: { ok, title, reason } i.p.v. popups ----
  {
    const minion = manif({ id: "mi", name: "Rat", subtypes: ["Minion"], body: 2 });
    const mk = (card, settings) => { const t = setup({ mi: card }, settings); t.ci = mkCi("i1", "mi"); t.arena.players[0].inPlayBody.push(t.ci); return t; };
    let t = mk(minion);
    let r = t.E.attackWithMinion(1, 0, "inPlayBody", "i1");
    ok(!r.ok && r.title === "Attack niet toegestaan" && /eigen kaarten/.test(r.reason), "attack: andere speler = weigering met titel en reden");
    ok(!t.ci.tapped && t.arena.stack.length === 0, "attack: bij weigering niets gewijzigd");
    r = t.E.attackWithMinion(0, 0, "inPlayBody", "i1");
    eq(r, { ok: true }, "attack: eigenaar mag");
    ok(t.ci.tapped, "attack: Minion exhausted (cost)");
    eq(t.arena.stack.length, 1, "attack: damage-entry op de stack");
    ok(t.arena.stack[0].isDamage && t.arena.stack[0].damageType === "body" && t.arena.stack[0].amount === 2 && t.arena.stack[0].targetIdx === 1, "attack: type en waarde uit de zone");
    eq(t.counts.save, 1, "attack: precies een save");
    r = t.E.attackWithMinion(0, 0, "inPlayBody", "i1");
    ok(!r.ok && !!r.reason, "attack: al exhausted = weigering");
    eq(t.arena.stack.length, 1, "attack: geen tweede entry");
    t = mk(manif({ id: "mi", subtypes: ["Minion"], body: 0 }));
    r = t.E.attackWithMinion(null, 0, "inPlayBody", "i1");
    ok(!r.ok && r.title === "Geen schade", "attack: stat 0 = 'Geen schade'");
    ok(!t.ci.tapped, "attack: stat 0 = niets betaald");
    r = mk(manif({ id: "mi", subtypes: [] })).E.attackWithMinion(0, 0, "inPlayBody", "i1");
    eq(r, { ok: false }, "attack: geen Attack-ability = stil nee");
    eq(t.E.attackWithMinion(0, 0, "inPlayBody", "bestaatniet"), { ok: false }, "attack: onbekende instantie = stil nee");
  }

  // ---- activateAbility ----
  {
    const tower = manif({ id: "tw", name: "Toren", effects: [
      eff({ kind: "activated", action: "GainSpite", target: "controller", value: 2, costs: [{ type: "Action", value: 1 }] })
    ] });
    const t = setup({ tw: tower }); const ci = mkCi("i1", "tw"); t.arena.players[0].inPlayBody.push(ci);
    let r = t.E.activateAbility(1, 0, "inPlayBody", "i1", 0);
    ok(!r.ok && r.title === "Ability niet toegestaan", "ability: andere speler = weigering");
    eq(t.arena.stack.length, 0, "ability: bij weigering niets op de stack");
    r = t.E.activateAbility(0, 0, "inPlayBody", "i1", 0);
    eq(r, { ok: true }, "ability: eigenaar mag");
    eq(t.arena.players[0].counters.actions, 2, "ability: Action betaald");
    ok(t.arena.stack[0].isAbility && t.arena.stack[0].priorityWith === 1, "ability: entry met priority bij de tegenstander");
    eq(t.counts.save, 1, "ability: een save");
    eq(t.E.activateAbility(0, 0, "inPlayBody", "i1", 5), { ok: false }, "ability: onbekende index = stil nee");
    const off = setup({ tw: tower }, { abilityEffects: false }); off.arena.players[0].inPlayBody.push(mkCi("i1", "tw"));
    r = off.E.activateAbility(0, 0, "inPlayBody", "i1", 0);
    ok(!r.ok && /staan uit/.test(r.reason), "ability: instelling uit = reden");
    t.E.resolveAbilityEntry(t.arena.stack.pop());
    eq(t.arena.players[0].counters.spite, 2, "ability: resolve geeft Spite");
  }

  // ---- planStackDamage / pushChosenDamage ----
  {
    const spell = { id: "sp", type: "Incantation", name: "Straal", effects: [ eff({ kind: "trigger", trigger: "OnResolve", action: "Damage", target: "opponent", value: 3 }) ] };
    const t = setup({ sp: spell });
    const ci = mkCi("s1", "sp", { casterIdx: 0 });
    let r = t.E.planStackDamage(1, ci);
    ok(!r.ok && r.title === "Niet toegestaan", "plan: enkel de caster");
    r = t.E.planStackDamage(0, ci);
    ok(r.ok && r.choose && r.choose.base.amount === 3 && /3 schade/.test(r.choose.title), "plan: type onbekend -> UI moet kiezen");
    eq(t.arena.stack.length, 0, "plan: nog niets op de stack");
    t.E.pushChosenDamage(r.choose.base, "soul");
    ok(t.arena.stack.length === 1 && t.arena.stack[0].damageType === "soul" && t.arena.stack[0].amount === 3, "pushChosen: gekozen type");
    t.E.pushChosenDamage(r.choose.base, "kaas");
    eq(t.arena.stack.length, 1, "pushChosen: ongeldig type genegeerd");
    const fixed = { id: "f", type: "Incantation", name: "Vast", effects: [ eff({ kind: "trigger", trigger: "OnResolve", action: "Damage", target: "opponent", damageType: "mind", value: 1 }) ] };
    const t2 = setup({ f: fixed });
    r = t2.E.planStackDamage(null, mkCi("s2", "f", { casterIdx: 1 }));
    eq(r, { ok: true }, "plan: vast type = meteen op de stack");
    ok(t2.arena.stack[0].damageType === "mind" && t2.arena.stack[0].targetIdx === 0, "plan: vast type, doelwit = tegenstander van de caster");
    eq(t2.E.planStackDamage(null, mkCi("s3", "weg", { casterIdx: 0 })), { ok: false }, "plan: onbekende kaart = stil nee");
  }

  // ---- drawCards / otherPlayerIdx ----
  {
    const { arena, E } = setup({});
    arena.players[0].deck.push(mkCi("a")); arena.players[0].discard.push(mkCi("b"), mkCi("c"), mkCi("d"));
    eq(E.drawCards(0, 3), 3, "draw: 3 getrokken");
    eq(arena.players[0].hand.length, 3, "draw: in de hand");
    ok(logHas(arena, "schudt de discard"), "draw: reshuffle gelogd");
    eq(E.drawCards(0, 5), 1, "draw: stopt als alles op is");
    eq([E.otherPlayerIdx(0), E.otherPlayerIdx(1)], [1, 0], "otherPlayerIdx");
  }

  // ---- reactieve wachtrij en OnReady via Slumber-tikken ----
  {
    const sleeper = manif({ id: "sl", name: "Slaper", slumber: 1, effects: [
      eff({ kind: "trigger", trigger: "OnReady", action: "GainSpite", target: "controller", value: 1 })
    ] });
    const { arena, counts, E } = setup({ sl: sleeper });
    const ci = mkCi("i1", "sl"); arena.players[0].inPlayBody.push(ci);
    E.setTapped(0, "inPlayBody", "i1", true, { silent: true });
    eq(ci.counters.white, 1, "slumber: witte teller = Slumber");
    const spent = spendResources(arena.players[0], 0, 2);
    E.reactiveBlock(() => E.emitReadiedEvents(0, spent.readied));
    ok(!ci.tapped, "slumber: kaart weer ready");
    eq(arena.players[0].counters.spite, 1, "reactief: OnReady-effect gaf Spite");
    ok(logHas(arena, "OnReady"), "reactief: logregel");
    ok(counts.save >= 1, "reactief: het blok slaat na afloop een keer op");
  }

  // ---- Rest-triggers ----
  {
    const curse = { id: "cu", type: "Manifestation", name: "Bewaker", body: 1, mind: 1, soul: 1, effects: [
      eff({ kind: "trigger", trigger: "OnRest", action: "GainAction", target: "controller", value: 1 })
    ] };
    const { arena, E } = setup({ cu: curse });
    arena.players[0].inPlayMind.push(mkCi("i1", "cu"));
    const before = arena.players[0].counters.actions;
    E.fireRestTriggers(0, "direct");
    eq(arena.players[0].counters.actions, before + 1, "rest: OnRest direct");
    E.fireRestTriggers(0, "stack");
    eq(arena.players[0].counters.actions, before + 1, "rest: de stack-fase vuurt geen directe effecten");
  }

  console.log(passed + " geslaagd, " + failed + " mislukt");
  if (failed) process.exitCode = 1;
}

const read = (f) => fs.readFileSync(path.join(__dirname, "shared", f), "utf8");
const source = ["card-data.js", "game-rules.js", "game-mechanics.js", "game-engine.js"].map(read).join("\n;\n");
vm.runInNewContext(source + "\n(" + tests.toString() + ")();", { window: {}, console: console, process: process });
