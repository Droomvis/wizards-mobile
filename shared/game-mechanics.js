/* =========================================================================
   game-mechanics.js — de effectieve spelregel-laag (Fase 4, cfr. Road to
   sustainability.txt): checkCastLegality, tickSlumberOnce en de Manifestation/
   Destiny permanent-schade/dood-regel, verplaatst uit arena.html naar hier
   als gewone plain-JS-functies (Fase 2-beslissing 2026-09-05: optie a,
   BYOG-graphs vallen af voor dit soort regels).

   Ontwerpprincipe (cfr. Fase 2 spike-conclusie): elke functie hier is puur
   en krijgt alle relevante state expliciet als argument mee — geen enkele
   functie in dit bestand leest of schrijft een globale `arena`-variabele.
   arena.html blijft verantwoordelijk voor het uitpakken van zijn eigen state
   vóór de aanroep, en voor saveArena()/renderArenaBoard()/logAction() erna.

   Afhankelijkheden (beide referenties worden pas gelezen zodra de functies
   hieronder daadwerkelijk AANGEROEPEN worden, dus de exacte <script>-volgorde
   t.o.v. dit bestand maakt niet uit — enkel dat ze vóór het eerste gebruik
   geladen zijn):
     - TYPE_CONFIG, uit shared/card-render.js (gebruikt door checkCastLegality).
     - freshCounters(), uit shared/card-data.js (gebruikt door tickSlumberOnce;
       sinds Fase 4-vervolg 2026-09-05 — stond hiervoor inline gehardcodeerd
       omdat arena.html se eigen freshCounters() in een IIFE zat en dus niet
       bereikbaar was; nu verhuisd naar shared/card-data.js zodat er weer maar
       één plek is die de vorm {white, black} kent).
   ========================================================================= */

// ---- checkCastLegality --------------------------------------------------
// Legaliteit van een cast (punt 4, enkel afgedwongen als settings.
// enforceCastLegality aanstaat — zie tandwiel-menu in arena.html). Twee
// dingen worden gecontroleerd:
//   1) Genoeg Actions/Spite voor kaarten met een kost (cfr. TYPE_CONFIG).
//   2) Juiste beurt/priority: ligt de stack leeg, dan mag enkel de speler
//      aan zet (turn) casten; ligt er al iets op de stack, dan mag enkel wie
//      op dat moment priority heeft (cfr. de priority-stack in
//      castCardToStack/resolveStackTop in arena.html) er nog iets bovenop
//      casten — tenzij freeActionSpending dat voor de actieve speler vrijgeeft.
// Geeft { ok:true } of { ok:false, reason:"..." } terug; roept zelf niets aan
// (geen alert, geen state-wijziging) zodat dit los te herbruiken/testen is.
//
// state: { settings, stack, turn, players } — de relevante slices van arena.
// card: de al opgezochte kaart-data (bv. via findCard(ci.cardId) in
// arena.html), niet de card-instance zelf.
function checkCastLegality(state, casterIdx, card){
  const { settings, stack, turn, players } = state;
  if (!settings || !settings.enforceCastLegality) return { ok: true };

  if (stack.length === 0){
    if (turn === null || turn === undefined){
      return { ok: false, reason: "Het spel is nog niet gestart — wacht tot beide spelers Ready zijn." };
    }
    if (turn !== casterIdx){
      return { ok: false, reason: `Het is niet jouw beurt (aan zet: ${players[turn] ? players[turn].name : "?"}).` };
    }
  } else {
    const top = stack[stack.length - 1];
    // freeActionSpending: de speler die AAN ZET is hoeft niet te wachten tot
    // priority op de stack naar hem terugkeert om nog een kaart te casten —
    // enkel voor die actieve speler, en enkel voor deze ene voorwaarde; de
    // tegenstander (of de actieve speler zelf op een moment dat hij niet aan
    // zet is, bv. als reactie) heeft nog steeds gewoon priority nodig.
    const skipPriorityCheck = settings.freeActionSpending && turn === casterIdx;
    if (!skipPriorityCheck && top.priorityWith !== casterIdx){
      const activeName = players[top.priorityWith] ? players[top.priorityWith].name : "?";
      return { ok: false, reason: `Je hebt momenteel geen priority (die ligt bij ${activeName}) — wacht tot die Resolve klikt of zelf iets cast.` };
    }
  }

  const cfg = (typeof TYPE_CONFIG !== "undefined" && card) ? (TYPE_CONFIG[card.type] || null) : null;
  if (cfg && cfg.cost){
    const casterPlayer = players[casterIdx];
    const actionCost = parseInt(card.actionCost, 10) || 0;
    const spiteCost = parseInt(card.spiteCost, 10) || 0;
    const haveActions = casterPlayer.counters.actions || 0;
    const haveSpite = casterPlayer.counters.spite || 0;
    if (actionCost > haveActions){
      return { ok: false, reason: `Onvoldoende Actions: ${actionCost} nodig, ${haveActions} beschikbaar.` };
    }
    if (spiteCost > haveSpite){
      return { ok: false, reason: `Onvoldoende Spite: ${spiteCost} nodig, ${haveSpite} beschikbaar.` };
    }
  }

  return { ok: true };
}

// ---- tickSlumberOnce -----------------------------------------------------
// Slumber-mechanisme: enkel getapte (exhausted) in-play kaarten tellen mee.
// Staat er nog een wit Time Counter op, dan gaat er één af; staat de teller
// al op 0 (printed Slumber 0, of afgeteld in een vorige actie), dan wordt de
// kaart meteen ready. Verwerkt het aftikken/readyen voor ÉÉN besteedde actie
// van een speler. Herbruikt door zowel spendAction (klik op "Actions") als
// castCardToStack (elke actie die opgaat aan het casten van een
// Manifestation/Incantation/... simuleert op dezelfde manier een actie, per
// eenheid actionCost) — beide blijven in arena.html.
//
// player: het player-object uit arena.players[idx] (heeft inPlayBody/
// inPlayMind/inPlaySoul-arrays). Muteert de kaart-instances in die arrays
// in-place (zelfde gedrag als voorheen), en geeft enkel het aantal
// afgetikte/geready'de kaarten terug.
function tickSlumberOnce(player){
  let tickedCount = 0, readiedCount = 0;
  ["inPlayBody", "inPlayMind", "inPlaySoul"].forEach(zone => {
    player[zone].forEach(ci => {
      if (!ci.tapped) return;
      if (!ci.counters) ci.counters = freshCounters();
      if ((ci.counters.white || 0) > 0){
        ci.counters.white -= 1;
        tickedCount++;
      } else {
        ci.tapped = false;
        readiedCount++;
      }
    });
  });
  return { tickedCount, readiedCount };
}

// ---- Manifestation/Destiny permanent-schade & dood ------------------------
// (cfr. Gamerules-specificatie.txt, sectie 2c): elke Manifestation/Destiny
// die in het spel ligt, ligt altijd in exact één van de drie in-play zones
// en kan enkel schade van de overeenkomstige stat krijgen. Zodra de zwarte
// Damage-teller >= die stat, is de permanent Vulnerable/Confused/Forlorn —
// zelfde naamgeving als shieldStatusBadge() in arena.html voor Wizard-
// schilden, maar hier WEL met een gevolg (arena.html se
// addCounterToInstance doodt de kaart bij de volgende schade), in
// tegenstelling tot de puur informatieve Wizard-versie.
const PERMANENT_DAMAGE_LABELS = { inPlayBody: "Vulnerable", inPlayMind: "Confused", inPlaySoul: "Forlorn" };
const PERMANENT_DAMAGE_STATKEY = { inPlayBody: "body", inPlayMind: "mind", inPlaySoul: "soul" };

function permanentTakesZoneDamage(card){
  return !!card && (card.type === "Manifestation" || card.type === "Destiny");
}

function permanentRelevantStat(card, zone){
  const statKey = PERMANENT_DAMAGE_STATKEY[zone];
  if (!statKey) return 0;
  const raw = card[statKey];
  return (raw === "" || raw === null || raw === undefined) ? 0 : (parseInt(raw, 10) || 0);
}

function isPermanentVulnerable(card, zone, counters){
  if (!permanentTakesZoneDamage(card) || !PERMANENT_DAMAGE_LABELS[zone]) return false;
  const dmg = (counters && counters.black) || 0;
  return dmg >= permanentRelevantStat(card, zone);
}

function permanentStatusLabel(card, zone, counters){
  return isPermanentVulnerable(card, zone, counters) ? PERMANENT_DAMAGE_LABELS[zone] : "";
}

// ---- banishForWizardDamage -------------------------------------------------
// Gevolg van schade aan een WIZARD (los van de permanent-schaderegel hierboven,
// die geldt voor schade aan een specifieke kaart-instantie): elk schadepunt
// banisht exact 1 kaart, per schadetype uit een vaste bron — Body: top van het
// deck (index 0, zoals drawCard/shift), Mind: willekeurig uit de hand, Soul:
// willekeurig uit de discard (cfr. Interpreter-specificatie sectie 3 stap 3 en
// Gamerules-specificatie.txt 2f punt 3). Schild en offeren zitten er bewust NIET
// in: die mitigatie gebeurt (voorlopig) manueel door het schadebedrag aan te
// passen vóór deze functie wordt aangeroepen.
//
// player: het player-object uit arena.players[idx]. Muteert dat object in-place
// (kaarten gaan naar player.banished, met tapped/counters gereset zoals bij een
// gewone zone-wissel). Zijn er minder kaarten in de bron dan schade, dan wordt
// gebanisht wat er is. Geeft { sourceZone, wanted, banished[], shortfall } terug.
const WIZARD_DAMAGE_SOURCE_ZONE = { body: "deck", mind: "hand", soul: "discard" };

function banishForWizardDamage(player, damageType, amount){
  const wanted = Math.max(0, parseInt(amount, 10) || 0);
  const sourceZone = WIZARD_DAMAGE_SOURCE_ZONE[damageType] || null;
  const banished = [];
  if (!sourceZone) return { sourceZone: null, wanted, banished, shortfall: wanted };
  const pile = player[sourceZone];
  while (banished.length < wanted && pile.length > 0){
    const idx = damageType === "body" ? 0 : Math.floor(Math.random() * pile.length);
    const ci = pile.splice(idx, 1)[0];
    ci.tapped = false;
    ci.counters = freshCounters();
    player.banished.push(ci);
    banished.push(ci);
  }
  return { sourceZone, wanted, banished, shortfall: wanted - banished.length };
}
