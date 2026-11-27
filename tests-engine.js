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
    playedEffects: true, abilityEffects: true, enterPlayEffects: true, cardEffects: true, reactiveEffects: true, consultEffects: true };
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

  // ---- discardCardsWithTriggers / pushBurdenToStack (Consult-spec C1, 2026-11-27) ----
  {
    const burden = { id: "bu", type: "Burden", name: "Last", effects: [ eff({ kind: "trigger", trigger: "OnDiscard", action: "Damage", target: "controller", damageType: "mind", value: 1 }) ] };
    const bolt = { id: "bo", type: "Incantation", name: "Flits", effects: [ eff({ kind: "trigger", trigger: "OnDiscard", action: "Damage", target: "opponent", damageType: "body", value: 2 }) ] };
    const plain = { id: "pl", type: "Incantation", name: "Gewoon", effects: [] };
    const cards = { bu: burden, bo: bolt, pl: plain };

    // Burden-discard AAN: Burden eerst op de stack, daarna de OnDiscard-effecten van de rest.
    let t = setup(cards);
    let list = [mkCi("b1", "bu"), mkCi("x1", "bo"), mkCi("p1", "pl")];
    let r = t.E.discardCardsWithTriggers(0, list);
    eq(r, { toStack: 1, direct: 2 }, "discard: telling stack/direct");
    eq(t.arena.players[0].discard.map(c => c.instanceId), ["x1", "p1"], "discard: niet-Burdens direct in de discard (volgorde behouden)");
    ok(t.arena.stack[0].instanceId === "b1" && t.arena.stack[0].isDiscardTrigger, "discard: Burden eerst op de stack met isDiscardTrigger");
    ok(t.arena.stack[0].casterIdx === 0 && t.arena.stack[0].destPlayerIdx === 0 && t.arena.stack[0].destZone === "discard" && t.arena.stack[0].priorityWith === 1, "discard: Burden-entry: eigenaar is caster, tegenstander heeft priority");
    ok(t.arena.stack[1] && t.arena.stack[1].isDamage && t.arena.stack[1].damageType === "body" && t.arena.stack[1].targetIdx === 1, "discard: OnDiscard-schade van Flits komt NA de Burden op de stack");
    eq(t.arena.stack.length, 2, "discard: de Burden zelf vuurt nog niet (pas bij Resolve)");
    eq(t.counts.save, 1, "discard: een save per Burden-push (zoals voorheen)");
    ok(logHas(t.arena, "Burden \"Last\""), "discard: logregel Burden-stack");

    // Burden-discard UIT: alles direct in de discard, OnDiscard vuurt ook voor de Burden.
    t = setup(cards, { burdenDiscardStack: false });
    r = t.E.discardCardsWithTriggers(0, [mkCi("b1", "bu"), mkCi("x1", "bo")]);
    eq(r, { toStack: 0, direct: 2 }, "discard uit: alles direct");
    eq(t.arena.players[0].discard.length, 2, "discard uit: beide in de discard");
    eq(t.arena.stack.map(e => e.damageType).sort(), ["body", "mind"], "discard uit: beide OnDiscard-effecten vuurden");

    // discardEffects UIT: wel verplaatst, geen OnDiscard.
    t = setup(cards, { discardEffects: false });
    t.E.discardCardsWithTriggers(0, [mkCi("x1", "bo")]);
    eq([t.arena.players[0].discard.length, t.arena.stack.length], [1, 0], "discardEffects uit: wel in de discard, geen effect");

    // silent: geen save per Burden-push; de aanroeper slaat zelf op.
    t = setup(cards);
    t.E.discardCardsWithTriggers(1, [mkCi("b1", "bu")], { silent: true });
    eq([t.counts.save, t.counts.render], [0, 0], "discard silent: geen save/render");
    eq(t.arena.stack[0].priorityWith, 0, "discard: Burden van speler 1 -> priority bij speler 0");

    // randgevallen: lege lijst, onbekende speler, verwijderde kaart, reset van tapped/counters.
    t = setup(cards);
    eq(t.E.discardCardsWithTriggers(0, []), { toStack: 0, direct: 0 }, "discard: lege lijst = niets");
    eq(t.E.discardCardsWithTriggers(5, [mkCi("x1", "bo")]), { toStack: 0, direct: 0 }, "discard: onbekende speler = niets");
    const ghost = mkCi("g1", "bestaatniet", { tapped: true });
    ghost.counters.black = 2;
    t.E.discardCardsWithTriggers(0, [ghost]);
    ok(t.arena.players[0].discard.includes(ghost) && !ghost.tapped && ghost.counters.black === 0, "discard: verwijderde kaart gaat toch naar de discard, tapped/tellers gereset");
    eq(t.arena.stack.length, 0, "discard: verwijderde kaart vuurt niets");
  }

  // ---- Consult (Consult-spec C3, 2026-11-27) ----
  {
    const burden = { id: "bu", type: "Burden", name: "Last", effects: [ eff({ kind: "trigger", trigger: "OnEnterHand", action: "Damage", target: "controller", damageType: "mind", value: 1 }) ] };
    const bolt = { id: "bo", type: "Incantation", name: "Flits", effects: [ eff({ kind: "trigger", trigger: "OnDiscard", action: "Damage", target: "opponent", damageType: "body", value: 2 }) ] };
    const plain = { id: "pl", type: "Manifestation", name: "Muur", subtypes: [], effects: [] };
    const watcher = { id: "wa", type: "Manifestation", name: "Wachter", effects: [ eff({ kind: "trigger", trigger: "OnBanish", action: "GainSpite", target: "controller", value: 1 }) ] };
    const seerEff = (o) => eff(Object.assign({ kind: "trigger", trigger: "OnResolve", action: "Consult", target: "opponent", value: 2, consultZone: "deck", consultAction: "hand", consultPickMin: 1, consultPickMax: 1, consultRest: "bottomDeck" }, o || {}));
    const seer = { id: "se", type: "Incantation", name: "Ziener", effects: [ seerEff() ] };
    const bm = { id: "bm", type: "Burden", subtypes: ["Manifestation"], name: "Spook", effects: [ eff({ kind: "trigger", trigger: "OnEnterHand", action: "GainSpite", target: "controller", value: 2 }) ] };
    const cards = { bu: burden, bo: bolt, pl: plain, wa: watcher, se: seer, bm: bm };
    const D = (arena, idx, ids) => { arena.players[idx].deck = ids.map(id => mkCi(id, id.split("_")[0])); };
    const Z = (arena, idx, zone, ids) => { arena.players[idx][zone] = ids.map(id => mkCi(id, id.split("_")[0])); };
    const ids = (list) => list.map(c => c.instanceId);
    const spec = (o) => Object.assign({ casterIdx: 0, ownerIdx: 1, zone: "deck", count: 3, pickMin: 1, pickMax: 1, action: "hand", rest: "stay", sourceLabel: "Ziener" }, o || {});

    // start + bevestigen: deck van de tegenstander, 1 naar de hand van de EIGENAAR, de rest onderaan
    let t = setup(cards); D(t.arena, 1, ["pl_1", "bo_1", "bu_1", "pl_2"]);
    let s = t.E.startConsult(spec({ rest: "bottomDeck" }));
    ok(s.ok && t.arena.stack.length === 1 && t.arena.stack[0].isConsult && t.arena.stack[0].instanceId === s.entryId, "consult: entry op de stack");
    eq(t.counts.save, 1, "consult: start slaat een keer op");
    ok(logHas(t.arena, "A bekijkt de bovenste 3 kaart(en) van het deck van B"), "consult: logregel 'bekijkt'");
    eq(ids(t.arena.players[1].deck), ["pl_1", "bo_1", "bu_1", "pl_2"], "consult: starten verplaatst nog niets");
    let r = t.E.resolveConsult(1, s.entryId, { picks: ["bo_1"] });
    ok(!r.ok && r.title === "Consult niet toegestaan" && t.arena.stack.length === 1, "consult: enkel de caster mag bevestigen");
    r = t.E.resolveConsult(0, s.entryId, { picks: [] });
    ok(!r.ok && /minstens/.test(r.reason) && t.arena.stack.length === 1, "consult: te weinig gekozen = weigering, entry blijft");
    r = t.E.resolveConsult(0, s.entryId, { picks: ["pl_2"] });
    ok(!r.ok && /niet kiesbaar/.test(r.reason), "consult: een niet getoonde kaart kan niet gekozen worden");
    r = t.E.resolveConsult(0, "verzonnen", { picks: ["bo_1"] });
    eq(r, { ok: false }, "consult: onbekende entry = stil nee");
    const saves = t.counts.save;
    r = t.E.resolveConsult(0, s.entryId, { picks: ["bo_1"] });
    eq(r, { ok: true }, "consult: bevestigen werkt");
    eq(t.arena.stack.length, 0, "consult: entry van de stack");
    eq(ids(t.arena.players[1].hand), ["bo_1"], "consult: gekozen kaart in de hand van de EIGENAAR van het deck");
    eq(ids(t.arena.players[1].deck), ["pl_2", "pl_1", "bu_1"], "consult: niet-gekozen kaarten onderaan, in getoonde volgorde");
    eq(ids(t.arena.players[0].hand), [], "consult: de caster krijgt niets");
    ok(t.counts.save > saves, "consult: bevestigen slaat op");
    ok(!logHas(t.arena, "Flits") && !logHas(t.arena, "Last"), "consult: kaartnamen van verborgen verplaatsingen staan niet in het log");
    ok(logHas(t.arena, "een kaart: Deck (B) → Hand (B)"), "consult: verborgen verplaatsing staat anoniem in het log");
    ok(logHas(t.arena, "kiest 1 kaart(en) uit Deck van B"), "consult: logregel 'kiest'");
    eq(t.E.resolveConsult(0, s.entryId, { picks: ["bo_1"] }), { ok: false }, "consult: dubbel klikken doet niets");
    eq(ids(t.arena.players[1].hand), ["bo_1"], "consult: dubbel klikken verplaatst niets opnieuw");

    // volgorde bovenaan: de eerst gekozen kaart eindigt bovenaan
    t = setup(cards); D(t.arena, 0, ["pl_1", "pl_2", "pl_3", "pl_4"]);
    s = t.E.startConsult(spec({ ownerIdx: 0, pickMin: 3, pickMax: 3, action: "topDeck" }));
    t.E.resolveConsult(null, s.entryId, { picks: ["pl_3", "pl_1", "pl_2"] });
    eq(ids(t.arena.players[0].deck), ["pl_3", "pl_1", "pl_2", "pl_4"], "consult: topDeck in gekozen volgorde (herordening)");
    // bottomDeck
    t = setup(cards); D(t.arena, 0, ["pl_1", "pl_2", "pl_3", "pl_4"]);
    s = t.E.startConsult(spec({ ownerIdx: 0, pickMin: 2, pickMax: 2, action: "bottomDeck" }));
    t.E.resolveConsult(0, s.entryId, { picks: ["pl_2", "pl_1"] });
    eq(ids(t.arena.players[0].deck), ["pl_3", "pl_4", "pl_2", "pl_1"], "consult: bottomDeck in gekozen volgorde");

    // discard uit de hand van de tegenstander: Burden op de stack (curse), OnDiscard van de rest, namen openbaar
    t = setup(cards); Z(t.arena, 1, "hand", ["bu_1", "bo_1", "pl_1"]);
    s = t.E.startConsult(spec({ zone: "hand", pickMin: 3, pickMax: 3, action: "discard" }));
    t.E.resolveConsult(0, s.entryId, { picks: ["bu_1", "bo_1", "pl_1"] });
    eq(ids(t.arena.players[1].discard), ["bo_1", "pl_1"], "consult discard: niet-Burdens direct in de discard van de eigenaar");
    eq(t.arena.stack.map(e => e.isDiscardTrigger ? "burden" : (e.isDamage ? "damage" : "?")), ["burden", "damage"], "consult discard: Burden eerst op de stack, dan de OnDiscard-schade (de consult zelf is weg)");
    ok(t.arena.stack[0].casterIdx === 1 && t.arena.stack[0].priorityWith === 0, "consult discard: Burden van B -> priority bij A");
    ok(t.arena.stack[1].casterIdx === 1 && t.arena.stack[1].targetIdx === 0 && t.arena.stack[1].damageType === "body", "consult discard: OnDiscard-schade komt van de eigenaar van de kaart");
    ok(logHas(t.arena, "Flits: Hand (B) → Discard (B)"), "consult discard: discard is openbaar, naam staat in het log");
    // mill: deck -> discard triggert ook (B4)
    t = setup(cards); D(t.arena, 0, ["bu_1", "bo_1", "pl_1"]);
    s = t.E.startConsult(spec({ ownerIdx: 0, count: 2, pickMin: 2, pickMax: 2, action: "discard" }));
    t.E.resolveConsult(0, s.entryId, { picks: ["bu_1", "bo_1"] });
    eq(t.arena.stack.map(e => e.isDiscardTrigger ? "burden" : (e.isDamage ? "damage" : "?")), ["burden", "damage"], "consult mill: deck -> discard vuurt Burden-stack en OnDiscard");
    // Burden-discard UIT: direct in de discard
    t = setup(cards, { burdenDiscardStack: false }); Z(t.arena, 0, "hand", ["bu_1"]);
    s = t.E.startConsult(spec({ ownerIdx: 0, zone: "hand", action: "discard" }));
    t.E.resolveConsult(0, s.entryId, { picks: ["bu_1"] });
    eq([t.arena.players[0].discard.length, t.arena.stack.length], [1, 0], "consult discard: Burden-discard uit = direct in de discard");

    // banish vuurt OnBanish (consistent met discard)
    t = setup(cards); Z(t.arena, 0, "hand", ["wa_1"]);
    s = t.E.startConsult(spec({ ownerIdx: 0, zone: "hand", action: "banish" }));
    t.E.resolveConsult(0, s.entryId, { picks: ["wa_1"] });
    eq(ids(t.arena.players[0].banished), ["wa_1"], "consult banish: kaart in banished");
    eq(t.arena.players[0].counters.spite, 1, "consult banish: OnBanish vuurde (Spite +1)");
    ok(logHas(t.arena, "Wachter: Hand (A) → Banished (A)"), "consult banish: banished is openbaar, naam in het log");
    t = setup(cards, { reactiveEffects: false }); Z(t.arena, 0, "hand", ["wa_1"]);
    s = t.E.startConsult(spec({ ownerIdx: 0, zone: "hand", action: "banish" }));
    t.E.resolveConsult(0, s.entryId, { picks: ["wa_1"] });
    eq(t.arena.players[0].counters.spite, 0, "consult banish: reactieve triggers uit = geen OnBanish");

    // OnEnterHand: via Consult naar de hand, via trekken, via ReturnToHand
    t = setup(cards); Z(t.arena, 1, "discard", ["bu_1"]);
    s = t.E.startConsult(spec({ zone: "discard", action: "hand" }));
    t.E.resolveConsult(0, s.entryId, { picks: ["bu_1"] });
    eq(ids(t.arena.players[1].hand), ["bu_1"], "OnEnterHand consult: Burden uit de discard naar de hand");
    ok(t.arena.stack.length === 1 && t.arena.stack[0].isDamage && t.arena.stack[0].targetIdx === 1 && t.arena.stack[0].damageType === "mind", "OnEnterHand consult: de Burden doet schade aan haar eigenaar");
    t = setup(cards); D(t.arena, 1, ["bu_1", "pl_1"]);
    eq(t.E.drawCards(1, 1), 1, "OnEnterHand draw: een kaart getrokken");
    ok(t.arena.stack.length === 1 && t.arena.stack[0].isDamage && t.arena.stack[0].targetIdx === 1, "OnEnterHand draw: getrokken Burden doet schade");
    t = setup(cards); D(t.arena, 1, ["pl_1", "pl_2"]);
    t.E.drawCards(1, 2);
    eq(t.arena.stack.length, 0, "OnEnterHand draw: kaarten zonder zo'n effect doen niets");
    t = setup(cards, { reactiveEffects: false }); D(t.arena, 1, ["bu_1"]);
    t.E.drawCards(1, 1);
    eq(t.arena.stack.length, 0, "OnEnterHand draw: reactieve triggers uit = stil");
    t = setup(cards); t.arena.players[0].inPlayBody.push(mkCi("i1", "bm"));
    t.E.moveCardByEffect({ playerIdx: 0, zone: "inPlayBody", instanceId: "i1" }, "Bron", "ReturnToHand");
    eq(ids(t.arena.players[0].hand), ["i1"], "OnEnterHand ReturnToHand: kaart in de hand");
    eq(t.arena.players[0].counters.spite, 2, "OnEnterHand ReturnToHand: de trigger vuurde (Spite +2)");
    t = setup(cards); t.arena.players[0].inPlayBody.push(mkCi("i1", "bm"));
    t.E.moveCardByEffect({ playerIdx: 0, zone: "inPlayBody", instanceId: "i1" }, "Bron", "Banish");
    eq(t.arena.players[0].counters.spite, 0, "OnEnterHand: Banish vuurt het niet");

    // enkel kijken (pickMax 0), geen filter-treffers, lege zone
    t = setup(cards); D(t.arena, 1, ["pl_1", "pl_2"]);
    s = t.E.startConsult(spec({ pickMin: 0, pickMax: 0, rest: "bottomDeck" }));
    ok(s.ok && t.arena.stack[0].pickMax === 0, "consult kijken: pickMax 0 is geldig");
    r = t.E.resolveConsult(0, s.entryId, { picks: [] });
    ok(r.ok && ids(t.arena.players[1].deck).join() === "pl_1,pl_2", "consult kijken: niets gekozen, de rest gaat toch onderaan (volgorde blijft: eerste = hoogste van de onderste)");
    t = setup(cards);
    s = t.E.startConsult(spec());
    ok(!s.ok && /leeg/.test(s.reason) && t.arena.stack.length === 0, "consult leeg: geen entry, reden terug");
    ok(logHas(t.arena, "Consult niet toegepast"), "consult leeg: logregel (geen stille mislukking)");
    eq(t.counts.save, 0, "consult leeg: niets opgeslagen");
    t = setup(cards, { consultEffects: false }); D(t.arena, 1, ["pl_1"]);
    s = t.E.startConsult(spec());
    ok(!s.ok && s.title === "Consult staat uit" && t.arena.stack.length === 0, "consult uit: instelling uit = geen entry");
    t = setup(cards); D(t.arena, 1, ["pl_1", "pl_2"]);
    s = t.E.startConsult(spec({ filter: { type: "Incantation" } }));
    ok(s.ok && t.arena.stack[0].pickMax === 0 && t.arena.stack[0].pickable.length === 0, "consult filter: niets kiesbaar = enkel kijken");

    // silent
    t = setup(cards); D(t.arena, 1, ["pl_1"]);
    t.E.startConsult(spec(), { silent: true });
    eq([t.counts.save, t.counts.render, t.arena.stack.length], [0, 0, 1], "consult silent: geen save/render");

    // een bekeken kaart verdwijnt tussen start en bevestiging: weigering, entry blijft
    t = setup(cards); D(t.arena, 1, ["pl_1", "pl_2", "pl_3"]);
    s = t.E.startConsult(spec());
    t.arena.players[1].deck.shift();
    r = t.E.resolveConsult(0, s.entryId, { picks: ["pl_2"] });
    ok(!r.ok && /verplaatst/.test(r.reason) && t.arena.stack.length === 1, "consult: zone intussen gewijzigd = weigering, entry blijft");

    // de entry moet bovenaan liggen
    t = setup(cards); D(t.arena, 1, ["pl_1", "pl_2"]);
    s = t.E.startConsult(spec());
    t.E.pushDamageToStack({ casterIdx: 0, targetIdx: 1, damageType: "body", amount: 1, silent: true });
    eq(t.E.resolveConsult(0, s.entryId, { picks: ["pl_1"] }), { ok: false }, "consult: niet de bovenste entry = niets");

    // handmatig: action any + annuleren
    t = setup(cards); D(t.arena, 0, ["pl_1", "pl_2"]);
    s = t.E.startConsult(spec({ ownerIdx: 0, action: "any", pickMin: 0, pickMax: 2, manual: true }));
    r = t.E.resolveConsult(0, s.entryId, { picks: ["pl_1"] });
    ok(!r.ok && /bestemming/.test(r.reason), "consult handmatig: eerst een bestemming kiezen");
    r = t.E.cancelConsult(1, s.entryId);
    ok(!r.ok && r.title === "Niet toegestaan" && t.arena.stack.length === 1, "consult handmatig: enkel de caster kan annuleren");
    r = t.E.cancelConsult(0, s.entryId);
    ok(r.ok && t.arena.stack.length === 0 && ids(t.arena.players[0].deck).join() === "pl_1,pl_2", "consult handmatig: annuleren verplaatst niets");
    s = t.E.startConsult(spec({ ownerIdx: 0, action: "any", pickMin: 0, pickMax: 2, manual: true }));
    r = t.E.resolveConsult(0, s.entryId, { picks: ["pl_1"], action: "banish" });
    ok(r.ok && ids(t.arena.players[0].banished).join() === "pl_1", "consult handmatig: gekozen bestemming wordt gebruikt");
    s = t.E.startConsult(spec({ ownerIdx: 0, action: "hand", manual: false }));
    eq(t.E.cancelConsult(0, s.entryId), { ok: false }, "consult: een kaart-effect kan niet geannuleerd worden");

    // dispatcher: een kaart met een Consult-effect
    t = setup(cards); D(t.arena, 1, ["pl_1", "pl_2", "pl_3"]);
    t.E.fireOnResolveEffects(seer, 0, null, null);
    ok(t.arena.stack.length === 1 && t.arena.stack[0].isConsult, "dispatcher: OnResolve Consult zet een entry op de stack");
    const en = t.arena.stack[0];
    eq([en.casterIdx, en.ownerIdx, en.zone, en.shown.length, en.pickMin, en.pickMax, en.action, en.rest, en.sourceLabel], [0, 1, "deck", 2, 1, 1, "hand", "bottomDeck", "Ziener"], "dispatcher: velden uit het effect (target opponent = zone van de tegenstander)");
    eq(t.counts, { save: 0, render: 0 }, "dispatcher: slaat zelf niet op");
    const mine = { id: "se2", type: "Incantation", name: "Eigen", effects: [ seerEff({ target: "controller" }) ] };
    t = setup(Object.assign({ se2: mine }, cards)); D(t.arena, 0, ["pl_1", "pl_2"]);
    t.E.fireOnResolveEffects(mine, 0, null, null);
    eq(t.arena.stack[0].ownerIdx, 0, "dispatcher: target controller = eigen deck");
    t = setup(cards, { consultEffects: false }); D(t.arena, 1, ["pl_1"]);
    t.E.fireOnResolveEffects(seer, 0, null, null);
    eq(t.arena.stack.length, 0, "dispatcher: consultEffects uit = stil");
    t = setup(cards, { resolveEffects: false }); D(t.arena, 1, ["pl_1"]);
    t.E.fireOnResolveEffects(seer, 0, null, null);
    eq(t.arena.stack.length, 0, "dispatcher: de instelling van de trigger uit = stil");
    t = setup(cards);
    t.E.fireOnResolveEffects(seer, 0, null, null);
    ok(t.arena.stack.length === 0 && logHas(t.arena, "Consult niet toegepast"), "dispatcher: leeg deck = logregel, geen entry");
    const chosen = { id: "se3", type: "Incantation", name: "Gekozen", effects: [ seerEff({ target: "chosen" }) ] };
    t = setup(Object.assign({ se3: chosen }, cards)); D(t.arena, 1, ["pl_1"]);
    t.E.fireOnResolveEffects(chosen, 0, { kind: "card", playerIdx: 1, zone: "inPlayBody", instanceId: "x" }, null);
    ok(t.arena.stack.length === 0 && logHas(t.arena, "niet ondersteund"), "dispatcher: target chosen wordt niet ondersteund (logregel)");
    // een Consult als trigger-effect naast Damage: de Damage-entry ligt boven de consult
    const both = { id: "bo2", type: "Incantation", name: "Beide", effects: [ seerEff(), eff({ kind: "trigger", trigger: "OnResolve", action: "Damage", target: "opponent", damageType: "body", value: 1 }) ] };
    t = setup(Object.assign({ bo2: both }, cards)); D(t.arena, 1, ["pl_1", "pl_2"]);
    t.E.fireOnResolveEffects(both, 0, null, null);
    eq(t.arena.stack.map(e => e.isConsult ? "consult" : "damage"), ["consult", "damage"], "dispatcher: volgorde direct -> kaart -> Consult -> Damage (LIFO: Damage resolvet eerst)");

    // moveCardsBetweenZones rechtstreeks
    t = setup(cards); Z(t.arena, 0, "hand", ["pl_1", "pl_2"]);
    eq(t.E.moveCardsBetweenZones([{ instanceId: "pl_1", fromPlayerIdx: 0, fromZone: "hand", toPlayerIdx: 0, toZone: "hand", position: "any" }]).moved, 0, "move: hand -> hand doet niets");
    eq(t.E.moveCardsBetweenZones([{ instanceId: "bestaatniet", fromPlayerIdx: 0, fromZone: "hand", toPlayerIdx: 0, toZone: "discard", position: "any" }]).moved, 0, "move: onbekende kaart wordt overgeslagen");
    ok(logHas(t.arena, "lag niet meer"), "move: overgeslagen kaart staat in het log");
    eq(t.E.moveCardsBetweenZones(null).moved, 0, "move: geen lijst");
    t.arena.players[0].hand[0].tapped = true; t.arena.players[0].hand[0].counters.black = 3;
    t.E.moveCardsBetweenZones([{ instanceId: "pl_1", fromPlayerIdx: 0, fromZone: "hand", toPlayerIdx: 1, toZone: "banished", position: "any" }]);
    const bn = t.arena.players[1].banished[0];
    ok(bn && bn.instanceId === "pl_1" && !bn.tapped && bn.counters.black === 0, "move: tussen spelers mogelijk, tapped/tellers gereset");
    eq(t.counts, { save: 0, render: 0 }, "move: slaat zelf niet op");
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
