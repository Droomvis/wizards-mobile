/* tests-effecten.js — Node-tests voor het Effecten-traject, Fase A (Stap 2).
   Zie Effecten-specificatie.txt sectie 8.

   Gebruik (vanuit de map development):   node tests-effecten.js

   Laadt shared/card-data.js, shared/game-rules.js en shared/game-mechanics.js in
   één gedeelde scope (zoals de browser dat doet met <script>-tags) en voert de
   tests daarbinnen uit. Raakt arena.html niet aan. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function tests(){
  let passed = 0, failed = 0;
  function ok(cond, name){ if (cond){ passed++; } else { failed++; console.log("FAIL: " + name); } }
  function eq(a, b, name){ ok(JSON.stringify(a) === JSON.stringify(b), name + " (kreeg " + JSON.stringify(a) + ", verwachtte " + JSON.stringify(b) + ")"); }

  const mkPlayer = () => ({ counters: { actions: 0, spite: 0 }, deck: [], hand: [], inPlayBody: [], inPlayMind: [], inPlaySoul: [], discard: [], banished: [] });
  const mkCi = (id, o) => Object.assign({ instanceId: id, cardId: id, tapped: false, counters: freshCounters() }, o || {});
  const manif = (o) => Object.assign({ type: "Manifestation", body: 3, mind: 2, soul: 1, slumber: 1 }, o || {});

  // ---- collectTurnTriggerSources ----
  {
    const p0 = mkPlayer(), p1 = mkPlayer();
    p0.inPlaySoul.push(mkCi("s1"));
    p0.inPlayBody.push(mkCi("b1"), mkCi("b2", { tapped: true }));
    p0.inPlayMind.push(mkCi("m1"));
    p0.hand.push(mkCi("h1")); p0.discard.push(mkCi("d1")); p0.deck.push(mkCi("k1"));
    p1.inPlayBody.push(mkCi("x1"));
    const src = collectTurnTriggerSources([p0, p1], 0);
    eq(src.map(s => s.ci.instanceId), ["b1", "b2", "m1", "s1"], "turn-bronnen: volgorde Body/Mind/Soul, tapped telt mee, hand/discard/deck niet");
    eq(src.map(s => s.zone), ["inPlayBody", "inPlayBody", "inPlayMind", "inPlaySoul"], "turn-bronnen: zones");
    ok(src.every(s => s.ownerIdx === 0), "turn-bronnen: ownerIdx");
    eq(collectTurnTriggerSources([p0, p1], 1).map(s => s.ci.instanceId), ["x1"], "turn-bronnen: enkel de kaarten van die speler");
    eq(collectTurnTriggerSources([p0, p1], 5), [], "turn-bronnen: onbekende speler");
    eq(collectTurnTriggerSources(null, 0), [], "turn-bronnen: geen spelers");
    eq(collectTurnTriggerSources([mkPlayer()], 0), [], "turn-bronnen: lege zones");
    eq(collectTurnTriggerSources([{}], 0), [], "turn-bronnen: speler zonder zones");
  }

  // ---- applyGain ----
  {
    const p = mkPlayer();
    eq(applyGain(p, "actions", 2), 2, "gain: actions +2");
    p.counters.spite = 3;
    eq(applyGain(p, "spite", 1), 4, "gain: spite 3 +1");
    eq(applyGain(p, "actions", "2"), 4, "gain: string-getal");
    eq(applyGain(p, "actions", -5), 4, "gain: negatief telt als 0");
    eq(applyGain(p, "actions", 0), 4, "gain: 0");
    eq(applyGain(p, "bodyShield", 1), null, "gain: onbekende teller");
    eq(applyGain(null, "actions", 1), null, "gain: geen speler");
    eq(applyGain({}, "actions", 1), null, "gain: speler zonder counters");
    const q = { counters: {} };
    eq(applyGain(q, "spite", 2), 2, "gain: ontbrekende teller start op 0");
  }

  // ---- canPayCosts ----
  {
    const P = mkPlayer(); P.counters.actions = 2; P.counters.spite = 3;
    const ci = mkCi("c1"); const card = manif();
    P.inPlayBody.push(ci);
    eq(canPayCosts([], P, ci, card, "inPlayBody"), { ok: true }, "cost: lege lijst");
    ok(canPayCosts(undefined, P, ci, card, "inPlayBody").ok, "cost: undefined = lege lijst");
    ok(canPayCosts([{ type: "ExhaustSelf" }], P, ci, card, "inPlayBody").ok, "cost: ExhaustSelf ready in play");
    ok(!canPayCosts([{ type: "ExhaustSelf" }], P, ci, card, "hand").ok, "cost: ExhaustSelf buiten play");
    ok(!canPayCosts([{ type: "ExhaustSelf" }], P, mkCi("t", { tapped: true }), card, "inPlayBody").ok, "cost: ExhaustSelf op getapte kaart");
    ok(!canPayCosts([{ type: "ExhaustSelf" }], P, null, card, "inPlayBody").ok, "cost: ExhaustSelf zonder bron");
    ok(canPayCosts([{ type: "Spite", value: 3 }], P, ci, card, "inPlayBody").ok, "cost: Spite genoeg");
    const noSpite = canPayCosts([{ type: "Spite", value: 4 }], P, ci, card, "inPlayBody");
    ok(!noSpite.ok && noSpite.reason.includes("Spite"), "cost: Spite te weinig");
    ok(!canPayCosts([{ type: "Action", value: 1 }, { type: "Action", value: 2 }], P, ci, card, "inPlayBody").ok, "cost: twee Action-entries worden opgeteld (3 > 2)");
    ok(canPayCosts([{ type: "Action", value: 1 }, { type: "Action", value: 1 }], P, ci, card, "inPlayBody").ok, "cost: twee Action-entries 1+1 = 2");
    ok(canPayCosts([{ type: "Action", value: 0 }], P, ci, card, "inPlayBody").ok, "cost: Action 0");
    // SelfVulnerable
    ok(canPayCosts([{ type: "SelfVulnerable" }], P, ci, card, "inPlayBody").ok, "cost: SelfVulnerable op gezonde Manifestation");
    const vulnCi = mkCi("v", { counters: { white: 0, black: 3 } });
    const alreadyV = canPayCosts([{ type: "SelfVulnerable" }], P, vulnCi, card, "inPlayBody");
    ok(!alreadyV.ok && alreadyV.reason.includes("Vulnerable"), "cost: SelfVulnerable als al Vulnerable");
    ok(canPayCosts([{ type: "SelfVulnerable" }], P, mkCi("m"), card, "inPlayMind").ok, "cost: SelfVulnerable in Mind-zone (stat 2, black 0)");
    ok(!canPayCosts([{ type: "SelfVulnerable" }], P, ci, manif({ type: "Incantation" }), "inPlayBody").ok, "cost: SelfVulnerable op niet-permanent");
    ok(!canPayCosts([{ type: "SelfVulnerable" }], P, ci, manif({ body: 0 }), "inPlayBody").ok, "cost: SelfVulnerable bij stat 0 (al Vulnerable)");
    ok(!canPayCosts([{ type: "SelfVulnerable" }], P, ci, card, "hand").ok, "cost: SelfVulnerable buiten play");
    // niet ondersteund
    ok(!canPayCosts([{ type: "Discard", value: 1 }], P, ci, card, "inPlayBody").ok, "cost: Discard nog niet ondersteund");
    ok(!canPayCosts([{ type: "Foo" }], P, ci, card, "inPlayBody").ok, "cost: onbekend type");
    // geen mutatie
    const before = JSON.stringify([P, ci]);
    canPayCosts([{ type: "Spite", value: 1 }, { type: "Action", value: 1 }, { type: "ExhaustSelf" }, { type: "SelfVulnerable" }], P, ci, card, "inPlayBody");
    eq(JSON.stringify([P, ci]), before, "cost: canPayCosts muteert niets");
  }

  // ---- payCosts ----
  {
    // Spite + Action
    const P = mkPlayer(); P.counters.actions = 3; P.counters.spite = 2;
    const ci = mkCi("c1"); P.inPlayBody.push(ci);
    const r = payCosts([{ type: "Spite", value: 1 }, { type: "Action", value: 2 }], P, ci, manif(), "inPlayBody");
    ok(r.ok, "pay: Spite+Action ok");
    eq([P.counters.actions, P.counters.spite], [1, 1], "pay: tellers afgetrokken");
    eq(r.parts, ["1🔥", "2⚡"], "pay: parts");
  }
  {
    // Action tikt Slumber af en readiet
    const P = mkPlayer(); P.counters.actions = 1;
    const a = mkCi("A", { tapped: true, counters: { white: 1, black: 0 } });
    const b = mkCi("B", { tapped: true, counters: { white: 0, black: 0 } });
    const c = mkCi("C");
    P.inPlayBody.push(a, b); P.inPlayMind.push(c);
    const r = payCosts([{ type: "Action", value: 1 }], P, mkCi("src"), manif(), "inPlayBody");
    ok(r.ok && r.tickedCount === 1 && r.readiedCount === 1, "pay: Action -> 1 tick, 1 ready");
    ok(a.tapped && a.counters.white === 0, "pay: A tikt af naar 0, blijft tapped");
    ok(!b.tapped, "pay: B (wit 0) wordt ready");
    ok(!c.tapped && c.counters.white === 0, "pay: ongetapte kaart ongemoeid");
  }
  {
    // Action 2 op een kaart met wit 1: twee ticks
    const P = mkPlayer(); P.counters.actions = 2;
    const a = mkCi("A", { tapped: true, counters: { white: 1, black: 0 } });
    P.inPlayBody.push(a);
    const r = payCosts([{ type: "Action", value: 2 }], P, mkCi("src"), manif(), "inPlayBody");
    ok(r.ok && r.tickedCount === 1 && r.readiedCount === 1 && !a.tapped, "pay: Action 2 -> aftikken, dan ready");
  }
  {
    // Volgorde: ExhaustSelf als laatste, ook als hij eerst in de lijst staat
    const P = mkPlayer(); P.counters.actions = 1;
    const src = mkCi("src"); P.inPlayBody.push(src);
    const r = payCosts([{ type: "ExhaustSelf" }, { type: "Action", value: 1 }], P, src, manif({ slumber: 0 }), "inPlayBody");
    ok(r.ok && src.tapped && src.counters.white === 0, "pay: ExhaustSelf + Action, Slumber 0 -> bron blijft exhausted (niet meteen ready)");
    eq(r.parts, ["1⚡", "⤵ Exhaust"], "pay: ExhaustSelf staat als laatste in parts");
    const P2 = mkPlayer(); const s2 = mkCi("s2"); P2.inPlayBody.push(s2);
    payCosts([{ type: "ExhaustSelf" }], P2, s2, manif({ slumber: 2 }), "inPlayBody");
    ok(s2.tapped && s2.counters.white === 2, "pay: ExhaustSelf zet witte teller op Slumber");
  }
  {
    // SelfVulnerable
    const P = mkPlayer();
    const b = mkCi("b"); P.inPlayBody.push(b);
    const r = payCosts([{ type: "SelfVulnerable" }], P, b, manif(), "inPlayBody");
    ok(r.ok && b.counters.black === 3 && r.parts[0] === "Vulnerable", "pay: SelfVulnerable Body -> zwart = Body-stat, Vulnerable");
    const m = mkCi("m"); P.inPlayMind.push(m);
    const r2 = payCosts([{ type: "SelfVulnerable" }], P, m, manif(), "inPlayMind");
    ok(r2.ok && m.counters.black === 2 && r2.parts[0] === "Confused", "pay: SelfVulnerable Mind -> Confused");
    ok(!b.tapped, "pay: SelfVulnerable exhaust niet");
  }
  {
    // Mislukte betaling muteert niets
    const P = mkPlayer(); P.counters.actions = 1; P.counters.spite = 1;
    const ci = mkCi("c"); P.inPlayBody.push(ci);
    const before = JSON.stringify([P, ci]);
    const r = payCosts([{ type: "Spite", value: 1 }, { type: "Action", value: 2 }, { type: "ExhaustSelf" }], P, ci, manif(), "inPlayBody");
    ok(!r.ok && typeof r.reason === "string", "pay: mislukt met reden");
    eq(JSON.stringify([P, ci]), before, "pay: mislukte betaling muteert niets");
  }

  // ---- describeCosts (Stap 6) ----
  {
    eq(describeCosts([]), [], "describe: leeg");
    eq(describeCosts(undefined), [], "describe: undefined");
    eq(describeCosts([{ type: "ExhaustSelf" }]), ["⤵ Exhaust"], "describe: ExhaustSelf");
    eq(describeCosts([{ type: "ExhaustSelf" }, { type: "Action", value: 2 }, { type: "Spite", value: 1 }]), ["1🔥", "2⚡", "⤵ Exhaust"], "describe: betaalvolgorde, ExhaustSelf laatst");
    eq(describeCosts([{ type: "Spite", value: 1 }, { type: "Spite", value: 2 }]), ["3🔥"], "describe: dubbele Spite opgeteld");
    eq(describeCosts([{ type: "SelfVulnerable" }, { type: "Discard", value: 2 }]), ["2× Discard", "zichzelf Vulnerable"], "describe: Discard en SelfVulnerable");
    eq(describeCosts([{ type: "Spite", value: 0 }]), [], "describe: waarde 0 telt niet");
    eq(describeCosts([null, { type: "Foo" }]), [], "describe: onbekend/null genegeerd");
  }

  // ---- card-data.js: directe acties (Stap 1) ----
  {
    const drawEff = normalizeEffect({ kind: "trigger", trigger: "OnResolve", action: "Draw", target: "controller", value: 2 });
    eq(effectTargetNote("controller", drawEff), "", "note: Draw + controller");
    ok(effectTargetNote("allInPlay", drawEff).includes("werkt niet voor Draw"), "note: Draw + allInPlay");
    eq(effectTargetNote("chosen", drawEff), "", "note: Draw + chosen bij OnResolve");
    ok(effectTargetNote("chosen", Object.assign({}, drawEff, { trigger: "OnRest" })).includes("OnResolve"), "note: Draw + chosen bij OnRest");
    // Stap 3 (2026-11-21): de arena vuurt Draw/GainAction/GainSpite af bij OnResolve/OnDiscard/OnRest/OnOpponentRest
    eq(effectIssues(drawEff), [], "issues: Draw bij OnResolve zonder waarschuwingen");
    ok(isActionImplemented("Draw") && isActionImplemented("GainAction") && isActionImplemented("GainSpite"), "support: directe acties geimplementeerd");
    ["OnResolve", "OnDiscard", "OnRest", "OnOpponentRest"].forEach(t => {
      ["Draw", "GainAction", "GainSpite"].forEach(a => {
        const e = normalizeEffect({ kind: "trigger", trigger: t, action: a, target: "controller", value: 1 });
        eq(effectIssues(e), [], "issues: " + a + " bij " + t + " zonder waarschuwingen");
      });
    });
    // Stap 4 (2026-11-21): OnPlayed/StartOfTurn/EndOfTurn werken voor de directe acties
    ["OnPlayed", "StartOfTurn", "EndOfTurn"].forEach(t => {
      ["Draw", "GainAction", "GainSpite"].forEach(a => {
        const e = normalizeEffect({ kind: "trigger", trigger: t, action: a, target: "controller", value: 1 });
        eq(effectIssues(e), [], "issues: " + a + " bij " + t + " zonder waarschuwingen");
      });
      const dmg = normalizeEffect({ kind: "trigger", trigger: t, action: "Damage", target: "opponent", damageType: "body", value: 1 });
      ok(effectIssues(dmg).some(i => i.includes("werkt nog niet bij " + t)), "issues: Damage bij " + t + " blijft gemarkeerd (enkel directe acties)");
      const infl = normalizeEffect({ kind: "trigger", trigger: t, action: "Inflict", target: "opponent", burdenId: "b", value: 1 });
      ok(effectIssues(infl).some(i => i.includes("werkt nog niet bij " + t)), "issues: Inflict bij " + t + " blijft gemarkeerd (enkel directe acties)");
      const tp = normalizeEffect({ kind: "trigger", trigger: t, action: "Draw", target: "triggeringPlayer", value: 1 });
      ok(effectIssues(tp).some(i => i.includes("enkel bij OnRest/OnOpponentRest")), "issues: triggeringPlayer bij " + t + " gemarkeerd");
    });
    // Nog niet gebouwd: deze triggers blijven gemarkeerd (Stap 8/Fase D)
    ["OnEnterPlay", "OnLeavePlay"].forEach(t => {
      // Stap 8: afgevuurd bij automatische bronnen
      ["Draw", "GainAction", "GainSpite"].forEach(a => {
        eq(effectIssues(normalizeEffect({ kind: "trigger", trigger: t, action: a, target: "controller", value: 1 })), [], "issues: " + a + " bij " + t + " werkt (Stap 8)");
      });
      eq(effectIssues(normalizeEffect({ kind: "trigger", trigger: t, action: "Damage", target: "opponentZone", damageType: "body", value: 2 })), [], "issues: Damage opponentZone bij " + t + " werkt");
      eq(effectIssues(normalizeEffect({ kind: "trigger", trigger: t, action: "Inflict", target: "opponent", burdenId: "b1", value: 1 })), [], "issues: Inflict opponent bij " + t + " werkt");
      ok(effectIssues(normalizeEffect({ kind: "trigger", trigger: t, action: "Draw", target: "chosen", value: 1 })).some(i => i.includes("enkel bij OnResolve")), "issues: Draw chosen bij " + t + " gemarkeerd");
      ok(effectIssues(normalizeEffect({ kind: "trigger", trigger: t, action: "Inflict", target: "chosen", burdenId: "b1", value: 1 })).some(i => i.includes("chosen")), "issues: Inflict chosen bij " + t + " gemarkeerd");
      ok(effectIssues(normalizeEffect({ kind: "trigger", trigger: t, action: "Banish", target: "controller", value: 1 })).some(i => i.includes("self of chosen")), "issues: Banish + controller bij " + t + " gemarkeerd (enkel self/chosen, Stap 9b-3)");
    });
    ["OnExhausted", "OnReady", "OnBanish", "OnDamaged"].forEach(t => {
      // Fase D (Stap 10): deze triggers worden nu afgevuurd (zie het Fase D-blok onderaan)
      const e = normalizeEffect({ kind: "trigger", trigger: t, action: "Draw", target: "controller", value: 1 });
      eq(effectIssues(e), [], "issues: Draw bij " + t + " werkt (Fase D)");
    });
    eq(effectIssues(normalizeEffect({ kind: "trigger", trigger: "OnRest", action: "Draw", target: "triggeringPlayer", value: 1 })), [], "issues: triggeringPlayer bij OnRest werkt");
    ok(effectIssues(normalizeEffect({ kind: "trigger", trigger: "OnRest", action: "Draw", target: "chosen", value: 1 })).some(i => i.includes("enkel bij OnResolve")), "issues: Draw + chosen bij OnRest gemarkeerd");
    ok(effectIssues(normalizeEffect({ kind: "trigger", trigger: "OnResolve", action: "Draw", target: "allInPlay", value: 1 })).some(i => i.includes("werkt niet voor Draw")), "issues: Draw + allInPlay gemarkeerd");
    ok(!effectIssues(drawEff).some(i => i.includes("Waarde is 0")), "issues: Draw 2 heeft geen waarde-0-waarschuwing");
    const zero = normalizeEffect({ kind: "trigger", trigger: "StartOfTurn", action: "GainSpite", target: "controller", value: 0 });
    ok(effectIssues(zero).some(i => i.includes("Waarde is 0")), "issues: GainSpite 0");
    // activated non-attack krijgt de directe-actie-takken niet
    const act = normalizeEffect({ kind: "activated", action: "Draw", target: "controller", value: 1, costs: [{ type: "ExhaustSelf" }] });
    ok(!effectIssues(act).some(i => i.includes("Waarde is 0")), "issues: activated Draw valt buiten de directe tak");
  }

  // ---- regressie: bestaand gedrag ongewijzigd ----
  {
    const dmg = normalizeEffect({ kind: "trigger", trigger: "OnResolve", action: "Damage", target: "opponent", damageType: "body", value: 2 });
    eq(effectIssues(dmg), [], "regressie: Damage bij OnResolve zonder waarschuwingen");
    const infl = normalizeEffect({ kind: "trigger", trigger: "OnOpponentRest", action: "Inflict", target: "triggeringPlayer", burdenId: "b", value: 1 });
    eq(effectIssues(infl), [], "regressie: Inflict bij OnOpponentRest zonder waarschuwingen");
    ok(effectTargetNote("allInPlay", dmg) !== "", "regressie: Damage + allInPlay blijft gemarkeerd");
    const minion = getEffectiveEffects({ type: "Manifestation", subtypes: ["Minion"], effects: [] });
    ok(minion.length === 1 && minion[0].isAttack, "regressie: Minion impliceert de Attack");
    eq(effectIssues(minion[0]), [], "regressie: Minion-Attack zonder waarschuwingen");
    ok(isActionImplemented("Damage") && isActionImplemented("Inflict"), "regressie: Damage/Inflict nog geimplementeerd");
    ok(["ExhaustSelf", "Spite", "Action", "SelfVulnerable"].every(isCostImplemented) && !isCostImplemented("Discard"), "support: costs ExhaustSelf/Spite/Action/SelfVulnerable ondersteund, Discard niet (Stap 6)");
    const atk = (costs) => normalizeEffect({ kind: "activated", isAttack: true, action: "Damage", target: "opponentZone", costs });
    eq(effectIssues(atk([{ type: "ExhaustSelf" }, { type: "Spite", value: 1 }, { type: "Action", value: 1 }, { type: "SelfVulnerable" }])), [], "issues: Attack met Spite/Action/SelfVulnerable zonder waarschuwingen (Stap 6)");
    ok(effectIssues(atk([{ type: "Discard", value: 1 }])).some(i => i.includes("Discard")), "issues: Attack met Discard-cost blijft gemarkeerd");
  }

  // ---- generieke activated abilities (Stap 7) ----
  {
    const ab = (o) => normalizeEffect(Object.assign({ kind: "activated", action: "Draw", target: "controller", value: 1, costs: [{ type: "ExhaustSelf" }] }, o));
    eq(effectIssues(ab({})), [], "ability: Draw controller zonder waarschuwingen");
    eq(effectIssues(ab({ action: "GainAction", value: 2 })), [], "ability: GainAction zonder waarschuwingen");
    eq(effectIssues(ab({ action: "Damage", target: "opponentZone", damageType: "mind", value: 2 })), [], "ability: Damage opponentZone met type zonder waarschuwingen");
    eq(effectIssues(ab({ action: "Inflict", target: "opponent", burdenId: "b1", value: 1 })), [], "ability: Inflict met Burden zonder waarschuwingen");
    ok(effectIssues(ab({ action: "Damage", target: "opponent", damageType: "" })).some(i => i.includes("schadetype")), "ability: Damage zonder type gemarkeerd");
    ok(effectIssues(ab({ action: "Inflict", target: "opponent", burdenId: "" })).some(i => i.includes("Burden")), "ability: Inflict zonder Burden gemarkeerd");
    ok(effectIssues(ab({ value: 0 })).some(i => i.includes("Waarde is 0")), "ability: waarde 0 gemarkeerd");
    ok(effectIssues(ab({ action: "Banish" })).some(i => i.includes("Banish")), "ability: onondersteunde actie gemarkeerd");
    ok(effectIssues(ab({ target: "chosen" })).some(i => i.includes("chosen")), "ability: target chosen gemarkeerd");
    ok(effectIssues(ab({ target: "opponentZone" })).some(i => i.includes("opponentZone")), "ability: opponentZone bij Draw gemarkeerd");
    ok(effectIssues(ab({ costs: [{ type: "Discard", value: 1 }] })).some(i => i.includes("Discard")), "ability: Discard-cost gemarkeerd");
    eq(effectIssues(ab({ costs: [{ type: "Spite", value: 1 }, { type: "Action", value: 1 }, { type: "SelfVulnerable" }] })), [], "ability: Spite/Action/SelfVulnerable-kosten zonder waarschuwing");

    eq(resolveAbilityTargetIdx({ target: "controller", action: "Draw" }, 0).idx, 0, "abilityTarget: controller");
    eq(resolveAbilityTargetIdx({ target: "ownActiveWizard", action: "Draw" }, 1).idx, 1, "abilityTarget: ownActiveWizard");
    eq(resolveAbilityTargetIdx({ target: "opponent", action: "Draw" }, 0).idx, 1, "abilityTarget: opponent");
    eq(resolveAbilityTargetIdx({ target: "opponentActiveWizard", action: "Damage" }, 1).idx, 0, "abilityTarget: opponentActiveWizard");
    eq(resolveAbilityTargetIdx({ target: "opponentZone", action: "Damage" }, 0).idx, 1, "abilityTarget: opponentZone bij Damage = tegenstander");
    ok(resolveAbilityTargetIdx({ target: "opponentZone", action: "Draw" }, 0).idx === null, "abilityTarget: opponentZone bij Draw -> overslaan");
    ok(resolveAbilityTargetIdx({ target: "chosen", action: "Draw" }, 0).idx === null, "abilityTarget: chosen -> overslaan");
    ok(resolveAbilityTargetIdx({ target: "triggeringPlayer", action: "Draw" }, 0).idx === null, "abilityTarget: triggeringPlayer -> overslaan");
    ok(resolveAbilityTargetIdx(null, 0).idx === null, "abilityTarget: geen effect");

    eq(describeAbilityEffect({ action: "Draw", value: 2, target: "controller" }), "Draw 2 → controller", "describeAbility: Draw");
    eq(describeAbilityEffect({ action: "Damage", value: 3, damageType: "soul", target: "opponentZone" }), "3 soul-schade → opponent", "describeAbility: Damage");
    eq(describeAbilityEffect({ action: "Inflict", value: 2, target: "opponent" }, "Fear"), "2× Burden \"Fear\" → opponent", "describeAbility: Inflict");
    eq(describeAbilityEffect(null), "", "describeAbility: null");
  }

  // ---- setTappedState + tickSlumberOnce.readied (Stap 9a) ----
  {
    // exhaust in play: tapped + witte teller op Slumber
    const a = mkCi("a");
    const r1 = setTappedState(a, manif({ slumber: 2 }), true, true);
    ok(r1.changed && r1.tapped && a.tapped, "setTapped: exhaust zet tapped");
    eq(a.counters.white, 2, "setTapped: exhaust zet witte teller op Slumber");
    eq(r1.white, 2, "setTapped: resultaat meldt witte teller");
    // exhaust zonder slumberApplies (zone zonder tellers): teller blijft
    const b = mkCi("b", { counters: { white: 5, black: 0 } });
    setTappedState(b, manif({ slumber: 2 }), true, false);
    ok(b.tapped, "setTapped: exhaust buiten tellerzone zet tapped");
    eq(b.counters.white, 5, "setTapped: exhaust buiten tellerzone laat teller ongemoeid");
    // Slumber 0 / ontbrekend
    const c = mkCi("c", { counters: { white: 4, black: 0 } });
    setTappedState(c, manif({ slumber: 0 }), true, true);
    eq(c.counters.white, 0, "setTapped: Slumber 0 zet teller op 0");
    const d = mkCi("d", { counters: { white: 4, black: 0 } });
    setTappedState(d, { type: "Manifestation" }, true, true);
    eq(d.counters.white, 0, "setTapped: kaart zonder slumber-veld = 0");
    const e = mkCi("e", { counters: { white: 4, black: 0 } });
    setTappedState(e, null, true, true);
    eq(e.counters.white, 0, "setTapped: geen kaartdata = 0");
    // ready: teller blijft staan
    const f = mkCi("f", { tapped: true, counters: { white: 3, black: 1 } });
    const r2 = setTappedState(f, manif({ slumber: 2 }), false, true);
    ok(r2.changed && !r2.tapped && !f.tapped, "setTapped: ready zet tapped uit");
    eq(f.counters, { white: 3, black: 1 }, "setTapped: ready laat beide tellers ongemoeid");
    // al in de gevraagde toestand: geen wijziging (C3)
    const g = mkCi("g", { tapped: true, counters: { white: 1, black: 0 } });
    const r3 = setTappedState(g, manif({ slumber: 9 }), true, true);
    ok(!r3.changed && g.tapped, "setTapped: exhaust op exhausted kaart = geen wijziging");
    eq(g.counters.white, 1, "setTapped: exhaust op exhausted kaart reset de teller NIET");
    const h = mkCi("h");
    ok(!setTappedState(h, manif(), false, true).changed, "setTapped: ready op ready kaart = geen wijziging");
    // randgevallen
    ok(!setTappedState(null, manif(), true, true).changed, "setTapped: geen kaart-instantie");
    const i = { instanceId: "i", cardId: "i" };
    setTappedState(i, manif({ slumber: 1 }), true, true);
    eq(i.counters.white, 1, "setTapped: ontbrekende counters worden aangemaakt");

    // payCosts (ExhaustSelf) gebruikt dezelfde functie: regressie
    const P = mkPlayer();
    const src = mkCi("src", { counters: { white: 7, black: 0 } });
    P.inPlayBody.push(src);
    const paid = payCosts([{ type: "ExhaustSelf" }], P, src, manif({ slumber: 3 }), "inPlayBody");
    ok(paid.ok && src.tapped, "payCosts: ExhaustSelf tapt nog steeds");
    eq(src.counters.white, 3, "payCosts: ExhaustSelf zet witte teller op Slumber");
    eq(paid.parts, ["⤵ Exhaust"], "payCosts: ExhaustSelf-logdeel ongewijzigd");

    // tickSlumberOnce geeft de geready'de kaarten terug
    const Q = mkPlayer();
    const t1 = mkCi("t1", { tapped: true, counters: { white: 0, black: 0 } });
    const t2 = mkCi("t2", { tapped: true, counters: { white: 2, black: 0 } });
    const t3 = mkCi("t3");
    const t4 = mkCi("t4", { tapped: true, counters: { white: 0, black: 0 } });
    Q.inPlayBody.push(t1, t2); Q.inPlayMind.push(t3); Q.inPlaySoul.push(t4);
    const tick = tickSlumberOnce(Q);
    eq([tick.tickedCount, tick.readiedCount], [1, 2], "tick: aantallen ongewijzigd");
    eq(tick.readied.map(x => x.ci.instanceId), ["t1", "t4"], "tick: readied bevat de geready'de kaarten in volgorde");
    eq(tick.readied.map(x => x.zone), ["inPlayBody", "inPlaySoul"], "tick: readied bevat de zone");
    ok(!t1.tapped && t2.tapped && t2.counters.white === 1 && !t4.tapped, "tick: staat van de kaarten ongewijzigd");
    eq(tickSlumberOnce(mkPlayer()).readied, [], "tick: lege speler -> lege readied");
  }

  // ---- kaart-effecten Exhaust/Ready (Stap 9b-1): resolveCardTargetRef + effectIssues ----
  {
    const src = { playerIdx: 1, zone: "inPlayMind", instanceId: "s1" };
    const self = { target: "self" }, chosen = { target: "chosen" };
    // self
    eq(resolveCardTargetRef(self, { trigger: "OnEnterPlay", sourceRef: src }), { ref: src, reason: "" }, "cardTarget: self met bron in play");
    const r1 = resolveCardTargetRef(self, { trigger: "StartOfTurn", sourceRef: { playerIdx: 0, zone: "hand", instanceId: "h" } });
    ok(r1.ref === null && r1.reason.includes("niet in play"), "cardTarget: self met bron in hand -> overslaan (C2)");
    ok(resolveCardTargetRef(self, { trigger: "OnResolve" }).ref === null, "cardTarget: self zonder sourceRef -> overslaan");
    ok(resolveCardTargetRef(self, {}).ref === null, "cardTarget: self zonder context -> overslaan");
    ok(resolveCardTargetRef(self).ref === null, "cardTarget: self zonder ctx-argument -> overslaan");
    ok(resolveCardTargetRef(self, { sourceRef: { playerIdx: 2, zone: "inPlayBody", instanceId: "x" } }).ref === null, "cardTarget: self met ongeldige speler");
    ok(resolveCardTargetRef(self, { sourceRef: { playerIdx: 0, zone: "inPlayBody", instanceId: "" } }).ref === null, "cardTarget: self zonder instanceId");
    ok(resolveCardTargetRef(self, { sourceRef: { playerIdx: 0, zone: "stack", instanceId: "x" } }).ref === null, "cardTarget: self op de stack -> niet in play");
    // chosen
    const tCard = { kind: "card", playerIdx: 0, zone: "inPlayBody", instanceId: "t1" };
    eq(resolveCardTargetRef(chosen, { trigger: "OnResolve", targetRef: tCard }), { ref: { playerIdx: 0, zone: "inPlayBody", instanceId: "t1" }, reason: "" }, "cardTarget: chosen op een kaart in play (eigen kaart)");
    eq(resolveCardTargetRef(chosen, { trigger: "OnResolve", targetRef: Object.assign({}, tCard, { playerIdx: 1, zone: "inPlaySoul" }) }).ref, { playerIdx: 1, zone: "inPlaySoul", instanceId: "t1" }, "cardTarget: chosen op een vijandelijke kaart (C5)");
    ok(resolveCardTargetRef(chosen, { targetRef: tCard }).ref !== null, "cardTarget: chosen zonder trigger in ctx wordt niet geweigerd");
    const rr = resolveCardTargetRef(chosen, { trigger: "OnRest", targetRef: tCard });
    ok(rr.ref === null && rr.reason.includes("OnResolve"), "cardTarget: chosen bij OnRest -> overslaan");
    ok(resolveCardTargetRef(chosen, { trigger: "OnEnterPlay", targetRef: tCard }).ref === null, "cardTarget: chosen bij OnEnterPlay -> overslaan");
    const rn = resolveCardTargetRef(chosen, { trigger: "OnResolve", targetRef: null });
    ok(rn.ref === null && rn.reason.includes("geen doelwit"), "cardTarget: chosen zonder targetRef");
    const rz = resolveCardTargetRef(chosen, { trigger: "OnResolve", targetRef: { kind: "zone", playerIdx: 1, zone: "inPlayBody" } });
    ok(rz.ref === null && rz.reason.includes("geen kaart"), "cardTarget: chosen met een zone als doelwit -> overslaan");
    const rd = resolveCardTargetRef(chosen, { trigger: "OnResolve", targetRef: Object.assign({}, tCard, { zone: "discard" }) });
    ok(rd.ref === null && rd.reason.includes("niet in play"), "cardTarget: chosen op een kaart buiten play -> overslaan (C2)");
    ok(resolveCardTargetRef(chosen, { trigger: "OnResolve", targetRef: Object.assign({}, tCard, { playerIdx: 5 }) }).ref === null, "cardTarget: chosen met ongeldige speler");
    // andere targets / randgevallen
    const rc = resolveCardTargetRef({ target: "controller" }, { sourceRef: src });
    ok(rc.ref === null && rc.reason.includes("self of chosen"), "cardTarget: controller werkt niet voor een kaart-effect");
    ok(resolveCardTargetRef(null, { sourceRef: src }).ref === null, "cardTarget: geen effect");
    // geen mutatie van de invoer
    const ctxBefore = JSON.stringify([src, tCard]);
    resolveCardTargetRef(self, { sourceRef: src }); resolveCardTargetRef(chosen, { trigger: "OnResolve", targetRef: tCard });
    eq(JSON.stringify([src, tCard]), ctxBefore, "cardTarget: muteert de invoer niet");

    // EFFECT_SUPPORT / effectIssues
    ok(isActionImplemented("Exhaust") && isActionImplemented("Ready"), "support: Exhaust en Ready zijn geimplementeerd (Stap 9b-1)");
    ok(isActionImplemented("ModifyShield"), "support: ModifyShield is geimplementeerd (Stap 9b-4, zie het ModifyShield-blok)");
    ok(isActionImplemented("Banish") && isActionImplemented("ReturnToHand"), "support: Banish en ReturnToHand zijn geimplementeerd (Stap 9b-3)");
    const ce = (trigger, action, target) => normalizeEffect({ kind: "trigger", trigger, action, target, value: 0 });
    ["Exhaust", "Ready"].forEach(a => {
      ["OnEnterPlay", "OnResolve", "StartOfTurn", "EndOfTurn", "OnRest", "OnOpponentRest"].forEach(t => {
        eq(effectIssues(ce(t, a, "self")), [], "issues: " + a + " self bij " + t + " zonder waarschuwingen (waarde telt niet mee)");
      });
      eq(effectIssues(ce("OnResolve", a, "chosen")), [], "issues: " + a + " chosen bij OnResolve zonder waarschuwingen");
      ok(effectIssues(ce("OnRest", a, "chosen")).some(i => i.includes("OnResolve")), "issues: " + a + " chosen bij OnRest gemarkeerd");
      ok(effectIssues(ce("OnEnterPlay", a, "chosen")).some(i => i.includes("OnResolve")), "issues: " + a + " chosen bij OnEnterPlay gemarkeerd");
      ok(effectIssues(ce("OnResolve", a, "controller")).some(i => i.includes("self of chosen")), "issues: " + a + " controller gemarkeerd");
      ok(effectIssues(ce("OnResolve", a, "opponent")).some(i => i.includes("self of chosen")), "issues: " + a + " opponent gemarkeerd");
      ["OnPlayed", "OnDiscard", "OnLeavePlay"].forEach(t => {
        ok(effectIssues(ce(t, a, "self")).length > 0, "issues: " + a + " self bij " + t + " gemarkeerd (kaart ligt dan niet in play)");
      });
      eq(effectIssues(ce("OnExhausted", a, "self")), [], "issues: " + a + " self bij OnExhausted werkt (Fase D)");
    });
    ok(effectIssues(normalizeEffect({ kind: "activated", action: "Exhaust", target: "self", costs: [{ type: "ExhaustSelf" }] })).some(i => i.includes("Exhaust")), "issues: Exhaust als activated ability nog gemarkeerd");
    // regressie: de directe acties en Damage/Inflict hebben dezelfde issues als voorheen
    eq(effectIssues(normalizeEffect({ kind: "trigger", trigger: "OnResolve", action: "Draw", target: "controller", value: 1 })), [], "regressie: Draw bij OnResolve nog zonder waarschuwingen");
    ok(effectTargetNote("self", { kind: "trigger", trigger: "OnResolve", action: "Draw" }) !== "", "regressie: Draw + self blijft gemarkeerd (geen kaart-actie)");
  }

  // ---- AddCounter / RemoveCounter (Stap 9b-2): adjustCounterState, counterColor, effectIssues ----
  {
    // adjustCounterState
    const a = mkCi("a", { counters: { white: 1, black: 2 } });
    eq(adjustCounterState(a, "white", 2), { changed: true, before: 1, after: 3 }, "counter: wit +2");
    eq(a.counters, { white: 3, black: 2 }, "counter: zwart blijft ongemoeid bij wit");
    eq(adjustCounterState(a, "black", 1), { changed: true, before: 2, after: 3 }, "counter: zwart +1");
    eq(adjustCounterState(a, "white", -1), { changed: true, before: 3, after: 2 }, "counter: wit -1");
    eq(adjustCounterState(a, "white", -5), { changed: true, before: 2, after: 0 }, "counter: verwijderen klemt op 0 (nooit negatief)");
    eq(adjustCounterState(a, "white", -1), { changed: false, before: 0, after: 0 }, "counter: niets te verwijderen = geen wijziging");
    eq(a.counters.white, 0, "counter: teller blijft 0");
    eq(adjustCounterState(a, "black", 0), { changed: false, before: 3, after: 3 }, "counter: delta 0");
    eq(adjustCounterState(a, "black", "2"), { changed: true, before: 3, after: 5 }, "counter: string-delta");
    eq(adjustCounterState(a, "black", "x"), { changed: false, before: 5, after: 5 }, "counter: ongeldige delta telt als 0");
    const b = mkCi("b", { counters: { white: 1, black: 1 } });
    eq(adjustCounterState(b, "red", 1), { changed: false, before: 0, after: 0 }, "counter: onbekende kleur");
    eq(b.counters, { white: 1, black: 1 }, "counter: onbekende kleur laat tellers ongemoeid");
    eq(adjustCounterState(null, "white", 1), { changed: false, before: 0, after: 0 }, "counter: geen instantie");
    const c = { instanceId: "c", cardId: "c" };
    eq(adjustCounterState(c, "white", 2).after, 2, "counter: ontbrekende counters worden aangemaakt");
    const d = mkCi("d", { counters: { white: 0 } });
    eq(adjustCounterState(d, "black", 1), { changed: true, before: 0, after: 1 }, "counter: ontbrekende zwarte teller start op 0");

    // normalizeEffect: counterColor
    eq(COUNTER_COLOR_LIST, ["white", "black"], "counterColor: lijst");
    eq(normalizeEffect({ action: "AddCounter", counterColor: "black" }).counterColor, "black", "counterColor: bewaard bij AddCounter");
    eq(normalizeEffect({ action: "RemoveCounter", counterColor: "white" }).counterColor, "white", "counterColor: bewaard bij RemoveCounter");
    eq(normalizeEffect({ action: "AddCounter", counterColor: "red" }).counterColor, "", "counterColor: ongeldige kleur wordt leeg (geen default)");
    eq(normalizeEffect({ action: "AddCounter" }).counterColor, "", "counterColor: ontbrekende kleur blijft leeg");
    eq(normalizeEffect({ action: "Draw", counterColor: "white" }).counterColor, "", "counterColor: genegeerd bij andere acties");
    eq(normalizeEffect({ action: "Exhaust", counterColor: "black" }).counterColor, "", "counterColor: genegeerd bij Exhaust");
    const roundTrip = normalizeEffect(JSON.parse(JSON.stringify(normalizeEffect({ action: "AddCounter", counterColor: "white", value: 2, target: "chosen", trigger: "OnResolve" }))));
    ok(roundTrip.counterColor === "white" && roundTrip.value === 2, "counterColor: overleeft normalize -> JSON -> normalize");

    // EFFECT_SUPPORT / effectIssues
    ok(isActionImplemented("AddCounter") && isActionImplemented("RemoveCounter"), "support: AddCounter en RemoveCounter zijn geimplementeerd (Stap 9b-2)");
    ok(isActionImplemented("ModifyShield"), "support: ModifyShield geimplementeerd (Stap 9b-4)");
    ok(EFFECT_SUPPORT.cardActions.includes("AddCounter") && EFFECT_SUPPORT.cardActions.includes("RemoveCounter"), "support: cardActions bevat de counter-acties");
    const cc = (trigger, action, target, color, value) => normalizeEffect({ kind: "trigger", trigger, action, target, counterColor: color, value: value === undefined ? 1 : value });
    ["AddCounter", "RemoveCounter"].forEach(act => {
      ["OnEnterPlay", "OnResolve", "StartOfTurn", "EndOfTurn", "OnRest", "OnOpponentRest"].forEach(t => {
        eq(effectIssues(cc(t, act, "self", "white")), [], "issues: " + act + " wit self bij " + t + " zonder waarschuwingen");
        eq(effectIssues(cc(t, act, "self", "black", 3)), [], "issues: " + act + " zwart self bij " + t + " zonder waarschuwingen");
      });
      eq(effectIssues(cc("OnResolve", act, "chosen", "black")), [], "issues: " + act + " chosen bij OnResolve zonder waarschuwingen");
      ok(effectIssues(cc("OnResolve", act, "self", "")).some(i => i.includes("tellerkleur")), "issues: " + act + " zonder kleur gemarkeerd");
      ok(effectIssues(cc("OnResolve", act, "self", "white", 0)).some(i => i.includes("Waarde is 0")), "issues: " + act + " met waarde 0 gemarkeerd");
      ok(effectIssues(cc("OnRest", act, "chosen", "white")).some(i => i.includes("OnResolve")), "issues: " + act + " chosen bij OnRest gemarkeerd");
      ok(effectIssues(cc("OnResolve", act, "controller", "white")).some(i => i.includes("self of chosen")), "issues: " + act + " controller gemarkeerd");
      ["OnPlayed", "OnDiscard", "OnLeavePlay"].forEach(t => {
        ok(effectIssues(cc(t, act, "self", "white")).length > 0, "issues: " + act + " self bij " + t + " gemarkeerd");
      });
      eq(effectIssues(cc("OnDamaged", act, "self", "white")), [], "issues: " + act + " self bij OnDamaged werkt (Fase D)");
      ok(effectIssues(normalizeEffect({ kind: "activated", action: act, target: "self", counterColor: "white", value: 1, costs: [{ type: "ExhaustSelf" }] })).some(i => i.includes(act)), "issues: " + act + " als activated ability nog gemarkeerd");
    });
    // regressie: Exhaust/Ready hebben geen kleur- of waarde-waarschuwing
    eq(effectIssues(normalizeEffect({ kind: "trigger", trigger: "OnResolve", action: "Exhaust", target: "self", value: 0 })), [], "regressie: Exhaust zonder kleur/waarde nog zonder waarschuwingen");
    eq(effectIssues(normalizeEffect({ kind: "trigger", trigger: "OnResolve", action: "Damage", target: "opponent", damageType: "body", value: 2 })), [], "regressie: Damage onveranderd");
  }

  // ---- ReturnToHand / Banish (Stap 9b-3): canMoveCardByEffect + effectIssues ----
  {
    // canMoveCardByEffect: bestemming per actie
    eq(canMoveCardByEffect("ReturnToHand", manif()), { ok: true, reason: "", destZone: "hand" }, "move: ReturnToHand op Manifestation -> hand");
    eq(canMoveCardByEffect("Banish", manif()), { ok: true, reason: "", destZone: "banished" }, "move: Banish op Manifestation -> banished");
    // Burden in play gedraagt zich als Manifestation (mini-spec Q5)
    eq(canMoveCardByEffect("Banish", { type: "Burden" }).destZone, "banished", "move: Burden mag gebanisht worden");
    eq(canMoveCardByEffect("ReturnToHand", { type: "Burden" }).destZone, "hand", "move: Burden mag naar de hand");
    // overige types mogen
    ["Hex", "Incantation"].forEach(t => {
      ok(canMoveCardByEffect("Banish", { type: t }).ok && canMoveCardByEffect("ReturnToHand", { type: t }).ok, "move: " + t + " toegestaan");
    });
    // Destiny en Wizard worden overgeslagen, met een reden per actie
    const dB = canMoveCardByEffect("Banish", { type: "Destiny" });
    ok(!dB.ok && dB.destZone === null && dB.reason === "Destiny kan nog niet gebanisht worden", "move: Destiny Banish -> overslaan met vaste reden (C6)");
    const dR = canMoveCardByEffect("ReturnToHand", { type: "Destiny" });
    ok(!dR.ok && dR.reason.includes("Destiny") && dR.reason.includes("hand"), "move: Destiny ReturnToHand -> overslaan");
    ok(!canMoveCardByEffect("Banish", { type: "Wizard" }).ok && canMoveCardByEffect("Banish", { type: "Wizard" }).reason.includes("Wizard"), "move: Wizard Banish -> overslaan");
    ok(!canMoveCardByEffect("ReturnToHand", { type: "Wizard" }).ok, "move: Wizard ReturnToHand -> overslaan");
    // randgevallen
    ok(!canMoveCardByEffect("Banish", null).ok && canMoveCardByEffect("Banish", null).destZone === null, "move: geen kaartdata -> overslaan");
    ok(!canMoveCardByEffect("Banish", undefined).ok, "move: undefined kaartdata -> overslaan");
    ok(!canMoveCardByEffect("Exhaust", manif()).ok && canMoveCardByEffect("Exhaust", manif()).reason.includes("verplaatst geen kaart"), "move: andere actie wordt geweigerd");
    ok(!canMoveCardByEffect("", manif()).ok, "move: lege actie wordt geweigerd");
    // geen mutatie
    const mCard = manif();
    const mBefore = JSON.stringify(mCard);
    canMoveCardByEffect("Banish", mCard);
    eq(JSON.stringify(mCard), mBefore, "move: muteert de kaart niet");

    // EFFECT_SUPPORT
    ok(EFFECT_SUPPORT.cardActions.includes("ReturnToHand") && EFFECT_SUPPORT.cardActions.includes("Banish"), "support: cardActions bevat ReturnToHand en Banish");
    eq(EFFECT_SUPPORT.cardActions, ["Exhaust", "Ready", "AddCounter", "RemoveCounter", "ReturnToHand", "Banish"], "support: cardActions volledig");
    // resolveCardTargetRef is gedeeld met de andere kaart-acties: self/chosen blijven werken, ook voor een vijandelijke kaart
    const enemy = { kind: "card", playerIdx: 1, zone: "inPlaySoul", instanceId: "e1" };
    eq(resolveCardTargetRef({ target: "chosen", action: "Banish" }, { trigger: "OnResolve", targetRef: enemy }).ref, { playerIdx: 1, zone: "inPlaySoul", instanceId: "e1" }, "move: chosen Banish op een vijandelijke kaart (C5)");
    eq(resolveCardTargetRef({ target: "self", action: "ReturnToHand" }, { trigger: "StartOfTurn", sourceRef: { playerIdx: 0, zone: "inPlayBody", instanceId: "s" } }).ref, { playerIdx: 0, zone: "inPlayBody", instanceId: "s" }, "move: self ReturnToHand met bron in play");

    // effectIssues: werkt bij de triggers waar de bron in play is, `value` telt niet mee (Q7)
    const mv = (trigger, action, target) => normalizeEffect({ kind: "trigger", trigger, action, target, value: 0 });
    ["ReturnToHand", "Banish"].forEach(a => {
      ["OnEnterPlay", "OnResolve", "StartOfTurn", "EndOfTurn", "OnRest", "OnOpponentRest"].forEach(t => {
        eq(effectIssues(mv(t, a, "self")), [], "issues: " + a + " self bij " + t + " zonder waarschuwingen (waarde telt niet mee)");
      });
      eq(effectIssues(mv("OnResolve", a, "chosen")), [], "issues: " + a + " chosen bij OnResolve zonder waarschuwingen");
      ok(effectIssues(mv("OnRest", a, "chosen")).some(i => i.includes("OnResolve")), "issues: " + a + " chosen bij OnRest gemarkeerd");
      ok(effectIssues(mv("OnEnterPlay", a, "chosen")).some(i => i.includes("OnResolve")), "issues: " + a + " chosen bij OnEnterPlay gemarkeerd");
      ok(effectIssues(mv("OnResolve", a, "controller")).some(i => i.includes("self of chosen")), "issues: " + a + " controller gemarkeerd");
      ok(effectIssues(mv("OnResolve", a, "opponent")).some(i => i.includes("self of chosen")), "issues: " + a + " opponent gemarkeerd");
      ["OnPlayed", "OnDiscard", "OnLeavePlay"].forEach(t => {
        ok(effectIssues(mv(t, a, "self")).length > 0, "issues: " + a + " self bij " + t + " gemarkeerd (kaart ligt dan niet in play of trigger niet ondersteund)");
      });
      ["OnExhausted", "OnReady", "OnDamaged"].forEach(t => {
        eq(effectIssues(mv(t, a, "self")), [], "issues: " + a + " self bij " + t + " werkt (Fase D)");
      });
      ok(effectIssues(mv("OnBanish", a, "self")).some(i => i.includes("niet in play")), "issues: " + a + " self bij OnBanish gemarkeerd (kaart ligt dan niet in play, Fase D)");
      ok(effectIssues(normalizeEffect({ kind: "activated", action: a, target: "self", costs: [{ type: "ExhaustSelf" }] })).some(i => i.includes(a)), "issues: " + a + " als activated ability nog gemarkeerd");
      // geen tellerkleur- of waarde-waarschuwing (enkel bij AddCounter/RemoveCounter)
      ok(!effectIssues(mv("OnResolve", a, "self")).some(i => i.includes("tellerkleur") || i.includes("Waarde")), "issues: " + a + " heeft geen kleur-/waarde-waarschuwing");
      eq(normalizeEffect({ action: a, counterColor: "white" }).counterColor, "", "counterColor: genegeerd bij " + a);
    });
    // regressie: Exhaust/Ready/Damage ongewijzigd (ModifyShield: zie het blok hieronder, Stap 9b-4)
    eq(effectIssues(normalizeEffect({ kind: "trigger", trigger: "OnResolve", action: "Exhaust", target: "self", value: 0 })), [], "regressie: Exhaust onveranderd");
    eq(effectIssues(normalizeEffect({ kind: "trigger", trigger: "OnResolve", action: "Damage", target: "opponent", damageType: "body", value: 2 })), [], "regressie: Damage onveranderd");
  }

  // ---- ModifyShield (Stap 9b-4): applyShieldChange, damageType als schildtype, effectIssues ----
  {
    const mkP = (c) => ({ counters: Object.assign({ bodyShield: 0, mindShield: 0, soulShield: 0 }, c || {}) });
    const none = { changed: false, before: 0, after: 0, key: null };

    // applyShieldChange: basis
    const p = mkP({ bodyShield: 1, mindShield: 2, soulShield: 3 });
    eq(applyShieldChange(p, 'body', 2), { changed: true, before: 1, after: 3, key: 'bodyShield' }, 'shield: body +2');
    eq(p.counters, { bodyShield: 3, mindShield: 2, soulShield: 3 }, 'shield: andere schilden ongemoeid');
    eq(applyShieldChange(p, 'mind', -1), { changed: true, before: 2, after: 1, key: 'mindShield' }, 'shield: mind -1');
    eq(applyShieldChange(p, 'soul', -5), { changed: true, before: 3, after: 0, key: 'soulShield' }, 'shield: verlagen klemt op 0 (nooit negatief)');
    eq(applyShieldChange(p, 'soul', -1), { changed: false, before: 0, after: 0, key: 'soulShield' }, 'shield: al 0 en verlagen = geen wijziging');
    eq(p.counters.soulShield, 0, 'shield: teller blijft 0');
    eq(applyShieldChange(p, 'body', 0), { changed: false, before: 3, after: 3, key: 'bodyShield' }, 'shield: delta 0');
    eq(applyShieldChange(p, 'body', '2').after, 5, 'shield: string-delta');
    eq(applyShieldChange(p, 'body', '-2').after, 3, 'shield: negatieve string-delta');
    eq(applyShieldChange(p, 'body', 'x'), { changed: false, before: 3, after: 3, key: 'bodyShield' }, 'shield: onleesbare delta telt als 0');
    eq(applyShieldChange(p, 'body', null).changed, false, 'shield: null-delta');
    eq(applyShieldChange(p, 'body', undefined).changed, false, 'shield: undefined-delta');
    eq(applyShieldChange(p, 'body', 1.9).after, 4, 'shield: decimale delta wordt afgekapt (1.9 -> 1)');
    eq(applyShieldChange(p, 'body', -1.9).after, 3, 'shield: decimale delta wordt afgekapt (-1.9 -> -1)');
    eq(applyShieldChange(p, 'body', 1000000).after, 1000003, 'shield: geen maximum');
    eq(applyShieldChange(p, 'body', -1000000).after, 3, 'shield: terug naar 3');

    // applyShieldChange: ongeldig schildtype (extra aandacht voor edge-cases van damageType)
    const snap = JSON.stringify(p);
    ['heart', '', 'Body', 'BODY', 'bodyShield', 'constructor', 'toString', '__proto__', 'hasOwnProperty', undefined, null, 1].forEach(t => {
      eq(applyShieldChange(p, t, 1), none, 'shield: onbekend schildtype ' + String(t) + ' -> geen wijziging');
    });
    eq(JSON.stringify(p), snap, 'shield: onbekend schildtype muteert niets (geen vreemde tellers)');

    // applyShieldChange: speler/teller-randgevallen
    eq(applyShieldChange(null, 'body', 1), none, 'shield: geen speler');
    eq(applyShieldChange({}, 'body', 1), none, 'shield: speler zonder counters');
    eq(applyShieldChange({ counters: {} }, 'mind', 2), { changed: true, before: 0, after: 2, key: 'mindShield' }, 'shield: ontbrekende teller start op 0');
    eq(applyShieldChange({ counters: {} }, 'mind', -2), { changed: false, before: 0, after: 0, key: 'mindShield' }, 'shield: ontbrekende teller en verlagen');
    eq(applyShieldChange({ counters: { bodyShield: -3 } }, 'body', 1), { changed: true, before: 0, after: 1, key: 'bodyShield' }, 'shield: negatieve teller telt als 0');
    eq(applyShieldChange({ counters: { bodyShield: 'x' } }, 'body', 2).after, 2, 'shield: onleesbare teller telt als 0');
    eq(applyShieldChange({ counters: { bodyShield: '2' } }, 'body', 1).after, 3, 'shield: tekst-teller wordt als getal gelezen');
    eq(applyShieldChange({ counters: { bodyShield: 1 } }, 'body', -1), { changed: true, before: 1, after: 0, key: 'bodyShield' }, 'shield: precies naar 0 telt als wijziging');

    // normalizeEffect: damageType is bij ModifyShield het schildtype
    DAMAGE_TYPE_LIST.forEach(t => eq(normalizeEffect({ action: 'ModifyShield', damageType: t }).damageType, t, 'normalize: schildtype ' + t + ' bewaard bij ModifyShield'));
    eq(normalizeEffect({ action: 'ModifyShield', damageType: 'Body' }).damageType, '', 'normalize: hoofdletter-type wordt leeg (geen default)');
    eq(normalizeEffect({ action: 'ModifyShield', damageType: 'heart' }).damageType, '', 'normalize: ongeldig schildtype wordt leeg');
    eq(normalizeEffect({ action: 'ModifyShield', damageType: 'constructor' }).damageType, '', 'normalize: constructor als schildtype wordt leeg');
    eq(normalizeEffect({ action: 'ModifyShield' }).damageType, '', 'normalize: ontbrekend schildtype blijft leeg');
    eq(normalizeEffect({ action: 'Draw', damageType: 'body' }).damageType, '', 'normalize: schildtype genegeerd bij Draw');
    eq(normalizeEffect({ action: 'Banish', damageType: 'mind' }).damageType, '', 'normalize: schildtype genegeerd bij Banish');
    eq(normalizeEffect({ action: 'Damage', damageType: 'soul' }).damageType, 'soul', 'regressie: Damage houdt zijn schadetype');
    eq(normalizeEffect({ kind: 'activated', isAttack: true, action: 'Damage', damageType: 'soul' }).damageType, '', 'regressie: Attack houdt geen schadetype');
    eq(normalizeEffect({ action: 'ModifyShield', value: -2 }).value, -2, 'normalize: negatieve waarde blijft bewaard');
    eq(normalizeEffect({ action: 'ModifyShield', value: '-3' }).value, -3, 'normalize: negatieve string-waarde');
    eq(normalizeEffect({ action: 'ModifyShield', value: 'abc' }).value, 0, 'normalize: onleesbare waarde wordt 0');
    const sw = normalizeEffect({ action: 'ModifyShield', damageType: 'mind', value: 2 });
    eq(normalizeEffect(Object.assign({}, sw, { action: 'Draw' })).damageType, '', 'normalize: wisselen van ModifyShield naar Draw wist het type');
    eq(normalizeEffect(Object.assign({}, sw, { action: 'Damage' })).damageType, 'mind', 'normalize: wisselen van ModifyShield naar Damage behoudt het type (zelfde veld)');
    const rt = normalizeEffect(JSON.parse(JSON.stringify(normalizeEffect({ trigger: 'OnResolve', action: 'ModifyShield', target: 'opponent', damageType: 'soul', value: -2 }))));
    ok(rt.damageType === 'soul' && rt.value === -2 && rt.action === 'ModifyShield', 'normalize: schildtype en negatieve waarde overleven normalize -> JSON -> normalize');

    // EFFECT_SUPPORT
    ok(isActionImplemented('ModifyShield'), 'support: ModifyShield is geimplementeerd');
    ok(EFFECT_SUPPORT.directActions.includes('ModifyShield'), 'support: ModifyShield is een directe actie');
    ok(!EFFECT_SUPPORT.abilityActions.includes('ModifyShield') && !EFFECT_SUPPORT.cardActions.includes('ModifyShield'), 'support: ModifyShield is geen ability- of kaartactie');

    // effectIssues per trigger
    const ms = (trigger, target, type, value) => normalizeEffect({ kind: 'trigger', trigger: trigger, action: 'ModifyShield', target: target, damageType: type, value: value });
    ['OnResolve', 'OnPlayed', 'OnEnterPlay', 'OnLeavePlay', 'OnDiscard', 'StartOfTurn', 'EndOfTurn', 'OnRest', 'OnOpponentRest'].forEach(t => {
      ['controller', 'ownActiveWizard', 'opponent', 'opponentActiveWizard'].forEach(tg => {
        eq(effectIssues(ms(t, tg, 'body', 2)), [], 'issues: ModifyShield +2 ' + tg + ' bij ' + t + ' zonder waarschuwingen');
        eq(effectIssues(ms(t, tg, 'soul', -2)), [], 'issues: ModifyShield -2 ' + tg + ' bij ' + t + ' zonder waarschuwingen (negatief is geldig)');
      });
      DAMAGE_TYPE_LIST.forEach(ty => eq(effectIssues(ms(t, 'controller', ty, 1)), [], 'issues: ModifyShield ' + ty + ' bij ' + t + ' zonder waarschuwingen'));
      ok(effectIssues(ms(t, 'controller', 'body', 0)).some(i => i.includes('Waarde is 0')), 'issues: ModifyShield waarde 0 bij ' + t + ' gemarkeerd');
      ok(effectIssues(ms(t, 'controller', '', 1)).some(i => i.includes('schildtype')), 'issues: ModifyShield zonder schildtype bij ' + t + ' gemarkeerd');
      ok(effectIssues(ms(t, 'controller', 'Body', 1)).some(i => i.includes('schildtype')), 'issues: ModifyShield met ongeldig schildtype bij ' + t + ' gemarkeerd');
      ['self', 'allInPlay', 'opponentZone'].forEach(tg => {
        ok(effectIssues(ms(t, tg, 'body', 1)).some(i => i.includes('werkt niet voor ModifyShield')), 'issues: ModifyShield + ' + tg + ' bij ' + t + ' gemarkeerd');
      });
      if (t === 'OnResolve') eq(effectIssues(ms(t, 'chosen', 'mind', -1)), [], 'issues: ModifyShield chosen bij OnResolve zonder waarschuwingen');
      else ok(effectIssues(ms(t, 'chosen', 'mind', -1)).some(i => i.includes('OnResolve')), 'issues: ModifyShield chosen bij ' + t + ' gemarkeerd');
      if (t === 'OnRest' || t === 'OnOpponentRest') eq(effectIssues(ms(t, 'triggeringPlayer', 'body', 1)), [], 'issues: ModifyShield triggeringPlayer bij ' + t + ' zonder waarschuwingen');
      else ok(effectIssues(ms(t, 'triggeringPlayer', 'body', 1)).some(i => i.includes('OnRest/OnOpponentRest')), 'issues: ModifyShield triggeringPlayer bij ' + t + ' gemarkeerd');
    });
    ['OnExhausted', 'OnReady', 'OnBanish', 'OnDamaged'].forEach(t => {
      eq(effectIssues(ms(t, 'controller', 'body', 1)), [], 'issues: ModifyShield bij ' + t + ' werkt (Fase D)');
      eq(effectIssues(ms(t, 'opponent', 'soul', -1)), [], 'issues: ModifyShield -1 opponent bij ' + t + ' werkt (Fase D)');
      ok(effectIssues(ms(t, 'chosen', 'mind', 1)).some(i => i.includes('OnResolve')), 'issues: ModifyShield chosen bij ' + t + ' gemarkeerd');
    });
    ok(effectIssues(normalizeEffect({ kind: 'activated', action: 'ModifyShield', target: 'controller', damageType: 'body', value: 1, costs: [{ type: 'ExhaustSelf' }] })).some(i => i.includes('ModifyShield')), 'issues: ModifyShield als activated ability nog gemarkeerd');

    // regressie: alleen ModifyShield mag een negatieve waarde hebben; de andere directe acties niet
    ok(effectIssues(normalizeEffect({ kind: 'trigger', trigger: 'OnResolve', action: 'Draw', target: 'controller', value: -1 })).some(i => i.includes('Waarde is 0')), 'regressie: Draw met negatieve waarde blijft gemarkeerd');
    eq(effectIssues(normalizeEffect({ kind: 'trigger', trigger: 'OnResolve', action: 'Draw', target: 'controller', value: 2 })), [], 'regressie: Draw +2 nog zonder waarschuwingen');
    eq(effectIssues(normalizeEffect({ kind: 'trigger', trigger: 'OnResolve', action: 'GainSpite', target: 'controller', value: 1, damageType: 'body' })), [], 'regressie: GainSpite krijgt geen schildtype-waarschuwing');
  }

  // ---- Fase D (Stap 10): reactieve triggers OnExhausted / OnReady / OnDamaged / OnBanish ----
  {
    const TR = ['OnExhausted', 'OnReady', 'OnDamaged', 'OnBanish'];
    const eff = (t, extra) => Object.assign({ kind: 'trigger', trigger: t, action: 'Draw', target: 'controller', value: 1 }, extra || {});
    const dec = (o) => decideReactiveEvent(Object.assign({ enabled: true, trigger: 'OnReady', effects: [eff('OnReady')], depth: 0 }, o || {}));

    // constanten en ondersteuning
    eq(REACTIVE_TRIGGERS, TR, 'reactief: de vier triggers');
    eq(REACTIVE_MAX_DEPTH, 1, 'reactief: standaard diepte 1 (D1)');
    TR.forEach(t => ok(isTriggerImplemented(t), 'reactief: ' + t + ' is geimplementeerd'));
    ['OnPlayed', 'OnResolve', 'OnRest', 'StartOfTurn'].forEach(t => ok(!REACTIVE_TRIGGERS.includes(t), 'reactief: ' + t + ' is geen reactieve trigger'));

    // decideReactiveEvent
    eq(dec(), { queue: true, code: '' }, 'decide: kaart met effect, diepte 0 -> in de rij');
    TR.forEach(t => eq(dec({ trigger: t, effects: [eff(t)] }), { queue: true, code: '' }, 'decide: ' + t + ' in de rij'));
    eq(dec({ enabled: false }), { queue: false, code: 'uit' }, 'decide: instelling uit');
    eq(dec({ enabled: undefined }), { queue: false, code: 'uit' }, 'decide: instelling ontbreekt = uit');
    eq(dec({ enabled: 1 }).queue, true, 'decide: truthy instelling telt als aan');
    ['OnPlayed', 'OnResolve', 'OnEnterPlay', '', undefined, null, 'onready', 'ONREADY'].forEach(t => eq(dec({ trigger: t }), { queue: false, code: 'onbekend' }, 'decide: onbekende trigger ' + String(t)));
    eq(decideReactiveEvent(), { queue: false, code: 'onbekend' }, 'decide: geen argument');
    eq(decideReactiveEvent(null), { queue: false, code: 'onbekend' }, 'decide: null-argument');
    eq(dec({ effects: [] }), { queue: false, code: 'geen-effect' }, 'decide: geen effecten = stil niets');
    eq(dec({ effects: undefined }), { queue: false, code: 'geen-effect' }, 'decide: effects ontbreekt');
    eq(dec({ effects: 'x' }), { queue: false, code: 'geen-effect' }, 'decide: effects is geen array');
    eq(dec({ effects: [null, undefined] }), { queue: false, code: 'geen-effect' }, 'decide: lege items in effects');
    eq(dec({ effects: [eff('OnExhausted')] }), { queue: false, code: 'geen-effect' }, 'decide: effect van een andere trigger telt niet');
    eq(dec({ effects: [{ kind: 'activated', trigger: 'OnReady', action: 'Draw' }] }), { queue: false, code: 'geen-effect' }, 'decide: een activated effect telt niet');
    eq(dec({ effects: [eff('OnExhausted'), eff('OnReady')] }).queue, true, 'decide: een passend effect tussen andere is genoeg');
    eq(dec({ depth: 1 }), { queue: false, code: 'diepte' }, 'decide: diepte 1 = te diep (D1)');
    eq(dec({ depth: 5 }), { queue: false, code: 'diepte' }, 'decide: diepte 5 = te diep');
    eq(dec({ depth: '1' }), { queue: false, code: 'diepte' }, 'decide: diepte als tekst');
    eq(dec({ depth: -3 }), { queue: true, code: '' }, 'decide: negatieve diepte telt als 0');
    eq(dec({ depth: 'x' }), { queue: true, code: '' }, 'decide: onleesbare diepte telt als 0');
    eq(dec({ depth: 2, maxDepth: 3 }), { queue: true, code: '' }, 'decide: maxDepth 3, diepte 2');
    eq(dec({ depth: 3, maxDepth: 3 }), { queue: false, code: 'diepte' }, 'decide: maxDepth 3, diepte 3');
    eq(dec({ depth: 0, maxDepth: 0 }), { queue: false, code: 'diepte' }, 'decide: maxDepth 0 blokkeert alles');
    eq(dec({ depth: 0, maxDepth: 'x' }).queue, true, 'decide: onleesbare maxDepth = standaard (1), diepte 0');
    eq(dec({ depth: 1, maxDepth: 'x' }).code, 'diepte', 'decide: onleesbare maxDepth = standaard (1), diepte 1');
    eq(dec({ enabled: false, effects: [] }).code, 'uit', 'decide: voorrang: uit gaat voor geen-effect');
    eq(dec({ effects: [], depth: 4 }).code, 'geen-effect', 'decide: zonder effect nooit "diepte" (geen logruis)');
    eq(dec({ trigger: 'OnPlayed', enabled: false }).code, 'onbekend', 'decide: voorrang: onbekend gaat voor uit');
    const effs = [eff('OnReady')]; const snapE = JSON.stringify(effs);
    dec({ effects: effs, depth: 1 });
    eq(JSON.stringify(effs), snapE, 'decide: muteert de invoer niet');

    // reactiveEffectsOf
    eq(reactiveEffectsOf([eff('OnReady'), eff('OnDamaged'), eff('OnReady', { action: 'Exhaust' })], 'OnReady').length, 2, 'effectsOf: filtert op trigger');
    eq(reactiveEffectsOf(null, 'OnReady'), [], 'effectsOf: null');
    eq(reactiveEffectsOf([eff('OnReady')], 'OnBanish'), [], 'effectsOf: geen treffer');

    // makeReactiveEvent
    const ref = { playerIdx: 1, zone: 'inPlayMind', instanceId: 'i1', extra: 'x' };
    const ev = makeReactiveEvent('OnExhausted', 1, 'card1', ref, 0);
    eq(ev, { trigger: 'OnExhausted', ownerIdx: 1, cardId: 'card1', sourceRef: { playerIdx: 1, zone: 'inPlayMind', instanceId: 'i1' }, depth: 0 }, 'event: geldig, extra veld van sourceRef valt weg');
    ok(ev.sourceRef !== ref, 'event: sourceRef is een kopie');
    eq(makeReactiveEvent('OnBanish', 0, 'c', null, 0).sourceRef, null, 'event: zonder sourceRef (OnBanish)');
    eq(makeReactiveEvent('OnBanish', 0, 'c', undefined).depth, 0, 'event: depth default 0');
    eq(makeReactiveEvent('OnBanish', 0, 'c', null, '2').depth, 2, 'event: depth als tekst');
    eq(makeReactiveEvent('OnBanish', 0, 'c', null, -4).depth, 0, 'event: negatieve depth wordt 0');
    eq(makeReactiveEvent('OnReady', 0, 'c', { playerIdx: 2, zone: 'inPlayBody', instanceId: 'i' }).sourceRef, null, 'event: sourceRef met ongeldige speler wordt null');
    eq(makeReactiveEvent('OnReady', 0, 'c', { playerIdx: 0, zone: 'inPlayBody' }).sourceRef, null, 'event: sourceRef zonder instanceId wordt null');
    eq(makeReactiveEvent('OnReady', 0, 'c', { playerIdx: '0', zone: 'inPlayBody', instanceId: 'i' }).sourceRef, null, 'event: sourceRef met speler als tekst wordt null');
    eq(makeReactiveEvent('OnPlayed', 0, 'c', null), null, 'event: geen reactieve trigger -> null');
    eq(makeReactiveEvent('OnReady', 2, 'c', null), null, 'event: ongeldige eigenaar (2) -> null');
    eq(makeReactiveEvent('OnReady', '0', 'c', null), null, 'event: eigenaar als tekst -> null');
    eq(makeReactiveEvent('OnReady', null, 'c', null), null, 'event: eigenaar null -> null');
    eq(makeReactiveEvent('OnReady', 0, '', null), null, 'event: lege cardId -> null');
    eq(makeReactiveEvent('OnReady', 0, undefined, null), null, 'event: cardId ontbreekt -> null');

    // dequeueReactiveEvent
    const q = [{ n: 1, trigger: 'OnReady' }, { n: 2, trigger: 'OnBanish' }, { n: 3, trigger: 'OnReady' }];
    eq(dequeueReactiveEvent(q).n, 1, 'queue: zonder filter het eerste (FIFO)');
    eq(q.map(x => x.n), [2, 3], 'queue: het item is uit de rij');
    eq(dequeueReactiveEvent(q, e => e.trigger === 'OnReady').n, 3, 'queue: filter slaat niet-passende items over');
    eq(q.map(x => x.n), [2], 'queue: de rest blijft staan, in volgorde');
    eq(dequeueReactiveEvent(q, e => e.trigger === 'OnDamaged'), null, 'queue: geen treffer -> null');
    eq(q.length, 1, 'queue: bij geen treffer blijft de rij ongemoeid');
    eq(dequeueReactiveEvent(q).n, 2, 'queue: laatste item');
    eq(dequeueReactiveEvent(q), null, 'queue: lege rij -> null');
    eq(dequeueReactiveEvent(null), null, 'queue: null -> null');
    eq(dequeueReactiveEvent(undefined), null, 'queue: undefined -> null');
    eq(dequeueReactiveEvent('abc'), null, 'queue: geen array -> null');
    const q2 = [{ id: 'a' }, { id: 'b' }]; const out = [];
    let nx; while ((nx = dequeueReactiveEvent(q2))) out.push(nx.id);
    eq(out, ['a', 'b'], 'queue: leegmaken geeft FIFO-volgorde');

    // payCosts geeft nu ook readied en exhausted terug (Fase D)
    {
      const P = mkPlayer(); P.counters.actions = 2;
      const a = mkCi('A', { tapped: true, counters: { white: 1, black: 0 } });
      const b = mkCi('B', { tapped: true, counters: { white: 0, black: 0 } });
      const src = mkCi('src');
      P.inPlayBody.push(a, src); P.inPlayMind.push(b);
      const r = payCosts([{ type: 'Action', value: 2 }, { type: 'ExhaustSelf' }], P, src, manif({ slumber: 0 }), 'inPlayBody');
      ok(r.ok && r.exhausted === true, 'pay: ExhaustSelf -> exhausted true');
      eq(r.readied.map(x => [x.ci.instanceId, x.zone]).sort(), [['A', 'inPlayBody'], ['B', 'inPlayMind']], 'pay: readied noemt kaart + zone (B bij tik 1, A bij tik 2)');
      ok(!r.readied.some(x => x.ci === src), 'pay: de bron-kaart zelf (nog niet exhausted bij de tikken) staat niet in readied');
      eq(r.readiedCount, 2, 'pay: readiedCount klopt met readied');
    }
    {
      const P = mkPlayer(); P.counters.spite = 1;
      const ci = mkCi('c'); P.inPlayBody.push(ci);
      const r = payCosts([{ type: 'Spite', value: 1 }], P, ci, manif(), 'inPlayBody');
      ok(r.ok && r.exhausted === false && Array.isArray(r.readied) && r.readied.length === 0, 'pay: zonder Exhaust/Action -> exhausted false, readied leeg');
      const r2 = payCosts([{ type: 'Spite', value: 5 }], P, ci, manif(), 'inPlayBody');
      ok(!r2.ok && r2.exhausted === undefined && r2.readied === undefined, 'pay: mislukte betaling geeft geen exhausted/readied');
    }

    // tickSlumberOnce: readied noemt de kaarten die ready werden
    {
      const P = mkPlayer();
      const a = mkCi('A', { tapped: true, counters: { white: 0, black: 0 } });
      const b = mkCi('B', { tapped: true, counters: { white: 2, black: 0 } });
      const c = mkCi('C');
      P.inPlayBody.push(a, b); P.inPlaySoul.push(c);
      const r = tickSlumberOnce(P);
      eq(r.readied.map(x => x.ci.instanceId + ':' + x.zone), ['A:inPlayBody'], 'tick: enkel A werd ready');
      eq([r.tickedCount, r.readiedCount], [1, 1], 'tick: aantallen blijven kloppen');
      eq(tickSlumberOnce(mkPlayer()).readied, [], 'tick: niets in play -> readied leeg');
    }

    // effectIssues voor de vier triggers
    const ei = (t, action, target, extra) => normalizeEffect(Object.assign({ kind: 'trigger', trigger: t, action: action, target: target, value: 1 }, extra || {}));
    TR.forEach(t => {
      ['Draw', 'GainAction', 'GainSpite'].forEach(a => {
        ['controller', 'ownActiveWizard', 'opponent', 'opponentActiveWizard'].forEach(tg => eq(effectIssues(ei(t, a, tg)), [], 'issues: ' + a + ' ' + tg + ' bij ' + t + ' werkt'));
        ok(effectIssues(ei(t, a, 'chosen')).some(i => i.includes('OnResolve')), 'issues: ' + a + ' chosen bij ' + t + ' gemarkeerd (D8)');
        ok(effectIssues(ei(t, a, 'triggeringPlayer')).some(i => i.includes('OnRest/OnOpponentRest')), 'issues: ' + a + ' triggeringPlayer bij ' + t + ' gemarkeerd');
        ok(effectIssues(ei(t, a, 'self')).some(i => i.includes('werkt niet voor')), 'issues: ' + a + ' self bij ' + t + ' gemarkeerd (speler-actie)');
      });
      ['controller', 'opponent', 'opponentZone'].forEach(tg => eq(effectIssues(ei(t, 'Damage', tg, { damageType: 'body', value: 2 })), [], 'issues: Damage ' + tg + ' bij ' + t + ' werkt (D9)'));
      ok(effectIssues(ei(t, 'Damage', 'chosen', { damageType: 'body', value: 2 })).some(i => i.includes('chosen') || i.includes('werkt niet')), 'issues: Damage chosen bij ' + t + ' gemarkeerd');
      ['controller', 'opponent'].forEach(tg => eq(effectIssues(ei(t, 'Inflict', tg, { burdenId: 'b1' })), [], 'issues: Inflict ' + tg + ' bij ' + t + ' werkt (D9)'));
      ok(effectIssues(ei(t, 'Inflict', 'chosen', { burdenId: 'b1' })).some(i => i.includes('chosen')), 'issues: Inflict chosen bij ' + t + ' gemarkeerd');
      ok(effectIssues(ei(t, 'Inflict', 'opponentZone', { burdenId: 'b1' })).some(i => i.includes('opponentZone')), 'issues: Inflict opponentZone bij ' + t + ' gemarkeerd');
      ['Exhaust', 'Ready', 'ReturnToHand', 'Banish'].forEach(a => {
        ok(effectIssues(ei(t, a, 'chosen')).some(i => i.includes('OnResolve')), 'issues: ' + a + ' chosen bij ' + t + ' gemarkeerd (D8)');
        ok(effectIssues(ei(t, a, 'controller')).some(i => i.includes('self of chosen')), 'issues: ' + a + ' controller bij ' + t + ' gemarkeerd');
        if (t === 'OnBanish') ok(effectIssues(ei(t, a, 'self')).some(i => i.includes('niet in play')), 'issues: ' + a + ' self bij OnBanish gemarkeerd (D6/D8)');
        else eq(effectIssues(ei(t, a, 'self')), [], 'issues: ' + a + ' self bij ' + t + ' werkt (D8)');
      });
      ['AddCounter', 'RemoveCounter'].forEach(a => {
        if (t === 'OnBanish') ok(effectIssues(ei(t, a, 'self', { counterColor: 'black' })).some(i => i.includes('niet in play')), 'issues: ' + a + ' self bij OnBanish gemarkeerd');
        else eq(effectIssues(ei(t, a, 'self', { counterColor: 'black' })), [], 'issues: ' + a + ' self bij ' + t + ' werkt');
        ok(effectIssues(ei(t, a, 'self', { counterColor: '' })).some(i => i.includes('tellerkleur')), 'issues: ' + a + ' zonder kleur bij ' + t + ' gemarkeerd');
      });
      ok(effectIssues(ei(t, 'Draw', 'controller', { value: 0 })).some(i => i.includes('Waarde is 0')), 'issues: Draw 0 bij ' + t + ' gemarkeerd');
      ok(effectIssues(ei(t, 'Heal', 'controller')).some(i => i.includes('Heal')), 'issues: Heal bij ' + t + ' blijft gemarkeerd (buiten scope)');
      ok(effectIssues(ei(t, 'Search', 'controller')).length > 0, 'issues: Search bij ' + t + ' blijft gemarkeerd');
    });
    // een conditie blijft altijd gemarkeerd, ook bij een reactieve trigger
    ok(effectIssues(ei('OnDamaged', 'Draw', 'controller', { condition: 'bodyShield == 0' })).some(i => i.includes('Conditie')), 'issues: conditie bij OnDamaged blijft gemarkeerd');
    // regressie: de al geimplementeerde triggers veranderen niet
    eq(effectIssues(ei('OnResolve', 'Banish', 'chosen')), [], 'regressie: Banish chosen bij OnResolve');
    ok(effectIssues(ei('OnLeavePlay', 'Banish', 'self')).some(i => i.includes('niet in play')), 'regressie: self bij OnLeavePlay nog gemarkeerd');
    ok(!isTriggerImplemented('OnNietBestaand'), 'regressie: onbekende trigger niet geimplementeerd');
  }

  // ---- Gedeelde basisregels (2026-11-25): isInPlayZone, castPaysCost, checkAffordable, spendResources ----
  {
    const FIRE = "\u{1F525}", BOLT = "\u26A1";
    ok(isInPlayZone("inPlayBody") && isInPlayZone("inPlayMind") && isInPlayZone("inPlaySoul"), "inPlay: de drie zones");
    ok(!isInPlayZone("hand") && !isInPlayZone("stack") && !isInPlayZone("deck") && !isInPlayZone("") && !isInPlayZone(undefined) && !isInPlayZone(null), "inPlay: andere zones niet");
    ok(!isInPlayZone("constructor") && !isInPlayZone("inPlay"), "inPlay: geen prototype-/deelmatches");

    ["Manifestation", "Incantation", "Hex", "Burden"].forEach(t => ok(castPaysCost({ type: t }), "castPaysCost: " + t + " betaalt"));
    ["Wizard", "Destiny", "Onbekend"].forEach(t => ok(!castPaysCost({ type: t }), "castPaysCost: " + t + " betaalt niet"));
    ok(!castPaysCost(null) && !castPaysCost(undefined), "castPaysCost: geen kaart");

    const P = mkPlayer(); P.counters.actions = 2; P.counters.spite = 1;
    eq(checkAffordable(P, 2, 1), { ok: true }, "afford: precies genoeg");
    const noAct = checkAffordable(P, 3, 0);
    ok(!noAct.ok && noAct.reason === "Onvoldoende Actions: 3 nodig, 2 beschikbaar.", "afford: te weinig Actions (melding ongewijzigd)");
    const noSpite = checkAffordable(P, 0, 2);
    ok(!noSpite.ok && noSpite.reason === "Onvoldoende Spite: 2 nodig, 1 beschikbaar.", "afford: te weinig Spite (melding ongewijzigd)");
    ok(checkAffordable(P, 3, 2).reason.includes("Actions"), "afford: Actions wordt eerst gemeld");
    eq(checkAffordable(null, 0, 0), { ok: true }, "afford: niets nodig, geen speler = ok");
    eq(checkAffordable(P, -1, "x"), { ok: true }, "afford: negatief/NaN telt als 0");
    eq(checkAffordable(null, 1, 0), { ok: false, reason: "Geen speler om kosten van te betalen." }, "afford: geen speler");
    eq(checkAffordable({}, 0, 1), { ok: false, reason: "Geen speler om kosten van te betalen." }, "afford: speler zonder counters");
    eq(canPayCosts([{ type: "Action", value: 1 }], null, null, null, "hand"), { ok: false, reason: "Geen speler om kosten van te betalen." }, "canPayCosts: geen speler (melding ongewijzigd)");

    // spendResources: Spite, dan Actions; elke Action tikt Slumber af
    const Q = mkPlayer(); Q.counters.actions = 3; Q.counters.spite = 2;
    const tapped = mkCi("t1", { tapped: true, counters: { white: 1, black: 0 } });
    const other = mkCi("t2");
    Q.inPlayBody.push(tapped); Q.inPlayMind.push(other);
    const r = spendResources(Q, 1, 2);
    eq(Q.counters.actions, 1, "spend: Actions 3 - 2");
    eq(Q.counters.spite, 1, "spend: Spite 2 - 1");
    eq(r.tickedCount, 1, "spend: eerste Action tikt de witte teller af");
    eq(r.readiedCount, 1, "spend: tweede Action readiet de kaart");
    eq(tapped.tapped, false, "spend: kaart is ready");
    eq(r.readied.map(x => x.ci.instanceId), ["t1"], "spend: readied[] bevat de kaart");
    eq(r.readied.map(x => x.zone), ["inPlayBody"], "spend: readied[] zone");
    eq(r.parts, ["1" + FIRE, "2" + BOLT], "spend: parts in volgorde Spite, Actions");
    eq(other.tapped, false, "spend: ongetapte kaart ongemoeid");
    const R = mkPlayer(); R.counters.actions = 1; R.counters.spite = 0;
    const r2 = spendResources(R, 5, 5);
    ok(R.counters.actions === 0 && R.counters.spite === 0, "spend: tellers zakken niet onder 0");
    eq(r2.parts, ["5" + FIRE, "5" + BOLT], "spend: parts tonen de gevraagde (niet de geklemde) waarde");
    const r3 = spendResources(mkPlayer(), 0, 0);
    eq(r3, { tickedCount: 0, readiedCount: 0, readied: [], parts: [] }, "spend: niets besteden");

    // payCosts blijft zich gedragen als voorheen (nu via spendResources)
    const S = mkPlayer(); S.counters.actions = 2; S.counters.spite = 1;
    const pc = payCosts([{ type: "Spite", value: 1 }, { type: "Action", value: 2 }], S, null, null, "hand");
    ok(pc.ok && S.counters.actions === 0 && S.counters.spite === 0, "payCosts: tellers betaald via spendResources");
    eq(pc.parts, ["1" + FIRE, "2" + BOLT], "payCosts: parts ongewijzigd");
    const S2 = mkPlayer(); S2.counters.actions = 1;
    const pc2 = payCosts([{ type: "Action", value: 2 }], S2, null, null, "hand");
    ok(!pc2.ok && S2.counters.actions === 1, "payCosts: onbetaalbaar = niets gemuteerd");

    // checkCastLegality leunt niet meer op TYPE_CONFIG (dat bestaat in deze testscope niet eens)
    ok(typeof TYPE_CONFIG === "undefined", "cast: TYPE_CONFIG is hier niet geladen (bewust)");
    const T = mkPlayer(); T.counters.actions = 1; T.counters.spite = 0;
    const st = { settings: { enforceCastLegality: true }, stack: [], turn: 0, players: [T] };
    const noPay = checkCastLegality(st, 0, { type: "Manifestation", actionCost: 2, spiteCost: 0 });
    ok(!noPay.ok && noPay.reason.includes("Actions"), "cast: Manifestation met te weinig Actions geweigerd (zonder TYPE_CONFIG)");
    ok(checkCastLegality(st, 0, { type: "Manifestation", actionCost: 1, spiteCost: 0 }).ok, "cast: genoeg Actions = ok");
    ok(checkCastLegality(st, 0, { type: "Destiny", actionCost: 9, spiteCost: 9 }).ok, "cast: een type zonder cast-kost betaalt niet");
    ok(checkCastLegality(st, 0, null).ok, "cast: geen kaartdata blokkeert niet");
    ok(checkCastLegality({ settings: { enforceCastLegality: false }, stack: [], turn: 1, players: [T] }, 0, { type: "Hex", actionCost: 9 }).ok, "cast: legaliteit uit = altijd ok");
  }

  console.log(passed + " geslaagd, " + failed + " mislukt");
  if (failed) process.exitCode = 1;
}

const read = (f) => fs.readFileSync(path.join(__dirname, "shared", f), "utf8");
const source = ["card-data.js", "game-rules.js", "game-mechanics.js"].map(read).join("\n;\n");
vm.runInNewContext(source + "\n(" + tests.toString() + ")();", { window: {}, console: console, process: process });
