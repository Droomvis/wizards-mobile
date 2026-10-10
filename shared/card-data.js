/* =========================================================================
   card-data.js — gedeeld datamodel voor een "kaart".
   Gebruikt door: cardbuilder.html, collectie.html, decks.html, arena.html.
   Laad dit bestand VOOR card-render.js (die enkel het tekenen doet, geen
   datamodel) en voor het eigen script van de module.

   Herkomst: TYPE_LIST/THEME_LIST/LOCATION_LIST/PHASE_LIST/STATUS_LIST en
   normalizeCard() waren tot nog toe letterlijk gedupliceerd in cardbuilder
   en arena. De arena-kopie miste het "createdBy"-veld in normalizeCard —
   hier bewust de volledige (cardbuilder-)versie aangehouden zodat createdBy
   overal beschikbaar blijft. */

const TYPE_LIST = ["Wizard","Manifestation","Incantation","Hex","Destiny","Burden"];
const THEME_LIST = ["Fire","Earth","Water","Sky","Shadow","Light"];
const LOCATION_LIST = ["The Citadel","The Harbour","The Barrow","The Maw","The Wildwood","The Observatory"];
const PHASE_LIST = ["Starter","Apprentice","Journeyman","Master"];
const STATUS_LIST = ["In Design","Playtesting","Balancing","Afgewerkt","Archived"];

/* -------------------------------------------------------------------------
   Uitbreiding t.b.v. arena-automatisatie en toekomstige draft-functionaliteit
   (besproken 2026-08-15). Additief: bestaande kaarten zonder deze velden
   blijven geldig, normalizeCard() vult overal veilige defaults in. ---------- */

// Subtypes zijn afhankelijk van het hoofd-type (cfr. TO DO: "Manifestation -
// Minion", "Burden - Manifestation" zijn te centraal om louter een vrije tag
// te zijn). Lege lijst = dat type heeft (nog) geen subtypes.
const SUBTYPE_LIST_BY_TYPE = {
  Wizard: [],
  Manifestation: ["Minion", "Structure"],
  Incantation: [],
  Hex: [],
  Destiny: [],
  Burden: ["Manifestation"]
};

// Vrij toegevoegde subtypes (cfr. Gamerules-specificatie.txt sectie 6):
// SUBTYPE_LIST_BY_TYPE hierboven blijft de vaste, ingebouwde basisset. Nieuwe
// subtypes die een ontwerper via de "+ Nieuw subtype"-knop aanmaakt, worden
// NIET in deze const bijgeschreven (dat zou de broncode moeten wijzigen),
// maar Drive-gesynchroniseerd bewaard als apart top-level veld
// "customSubtypes" in wizards-cards.json — een platte array van
// {name, type, createdBy, createdAt}. Elke module houdt zijn eigen
// `customSubtypes`-variabele bij (net als `collection`) en geeft die hier
// als parameter mee; dit bestand bewaart zelf geen state.

// Alle ingebouwde subtype-namen, over ALLE hoofdtypes heen — nodig voor de
// uniciteits-check (spec sectie 5: SUBTYPE_EFFECTS is een platte
// naamruimte, dus een nieuwe naam mag nergens, ook niet bij een ander type,
// al gebruikt zijn).
function getAllBuiltinSubtypeNames(){
  return Object.values(SUBTYPE_LIST_BY_TYPE).flat();
}

// Alle subtypes toegestaan voor een gegeven hoofd-type: de ingebouwde lijst
// aangevuld met de custom subtypes die voor dat type zijn aangemaakt.
function getAllowedSubtypes(type, customSubtypes){
  const builtin = SUBTYPE_LIST_BY_TYPE[type] || [];
  const custom = (customSubtypes || []).filter(s => s && s.type === type).map(s => s.name);
  return [...builtin, ...custom];
}

// Bestaat deze naam al, ongeacht bij welk type (ingebouwd of custom)? Case-
// insensitief, want "Beast" en "beast" zouden anders per ongeluk twee
// verschillende, botsende subtypes lijken.
function isSubtypeNameTaken(name, customSubtypes){
  const lower = String(name || "").trim().toLowerCase();
  if (!lower) return true; // lege naam is nooit geldig
  const builtinTaken = getAllBuiltinSubtypeNames().some(n => n.toLowerCase() === lower);
  if (builtinTaken) return true;
  return (customSubtypes || []).some(s => s && String(s.name || "").toLowerCase() === lower);
}

// Triggers: het moment waarop een effect afgaat. Sluit aan bij wat al in de
// arena-code als voorbeeld genoemd wordt (OnPlayed, OnExhausted).
// OnResolve (2026-10-10): afgaan op het moment dat de kaart zelf van de stack
// resolvet (bv. een Incantation met direct damage). Nog geen interpreter die
// dit automatisch uitvoert — zie Interpreter-specificatie sectie 6.
const TRIGGER_LIST = [
  "OnPlayed", "OnResolve", "OnEnterPlay", "OnLeavePlay",
  "OnExhausted", "OnReady", "OnRest",
  "StartOfTurn", "EndOfTurn",
  "OnDiscard", "OnBanish", "OnDamaged"
];

// Acties: wat het effect concreet doet. Kan later 1-op-1 gekoppeld worden aan
// bestaande arena-functies (adjustCounter, addCounterToInstance, drawCard,
// performCardMove, ...) zodra de engine gebouwd wordt.
const ACTION_LIST = [
  "Damage", "Heal",
  "AddCounter", "RemoveCounter",
  "ModifyShield", "ModifyStat",
  "Draw", "Discard", "Banish", "ReturnToHand",
  "GainAction", "GainSpite",
  "Exhaust", "Ready",
  "Search"
];

// Schadetype voor effecten met action:"Damage" (2026-10-10). Zelfde sleutels als
// arena.html (DAMAGE_TYPE_LABELS/pushDamageToStack) en PERMANENT_DAMAGE_STATKEY.
// Niet van toepassing op een Attack (isAttack:true): daar volgt het type uit de
// zone van de aanvallende kaart.
const DAMAGE_TYPE_LIST = ["body", "mind", "soul"];

// Target: wie/wat het effect raakt. "chosen" laat de speler kiezen (koppelt
// aan de bestaande openArenaChoice()-overlay in arena.html). "opponentZone"
// is specifiek voor Attack-abilities (isAttack:true): het doel is een ZONE
// bij de tegenstander, niet een specifieke kaart of de Wizard rechtstreeks —
// de verdediger kiest zelf hoe de schade opgevangen wordt (zie
// Gamerules-specificatie.txt sectie 2e). Welke zone (Body/Mind/Soul) volgt
// automatisch uit de zone van de aanvallende kaart, niet uit dit veld.
const TARGET_LIST = [
  "self", "controller", "opponent",
  "opponentActiveWizard", "ownActiveWizard",
  "opponentZone",
  "allInPlay", "allOpponentInPlay", "allOwnInPlay",
  "chosen"
];

const RARITY_LIST = ["Common", "Uncommon", "Rare", "Signature"];

// Kost-componenten voor ACTIVATED abilities (cfr. Gamerules-specificatie.txt
// sectie 2f, vraag 13): een activated ability betaalt geen "trigger", maar
// een combinatie van één of meer van deze componenten. `value` is enkel
// relevant voor Spite/Action/Discard (hoeveel); voor ExhaustSelf/
// SelfVulnerable wordt het genegeerd. Uitbreidbaar: nieuwe kost-types
// toevoegen volstaat, geen wijziging elders nodig zolang de interpreter
// (nog te bouwen) ze een-voor-een kan afhandelen.
const COST_TYPE_LIST = ["ExhaustSelf", "Spite", "Action", "Discard", "SelfVulnerable"];

function normalizeCostEntry(raw){
  raw = raw || {};
  return {
    type: COST_TYPE_LIST.includes(raw.type) ? raw.type : "ExhaustSelf",
    value: toNum(raw.value, 1)
  };
}

function normalizeEffect(raw){
  raw = raw || {};
  // kind: expliciet veld (cfr. Gamerules-specificatie.txt, vraag 7) i.p.v.
  // een impliciete conventie afgeleid uit trigger/cost — robuuster tegen
  // toekomstige combinaties. Migratie-fallback voor effects van vóór dit
  // veld bestond: had het effect al een cost, dan was het bedoeld als
  // activated ability; anders trigger.
  const legacyHadCost = raw.cost && (raw.cost.exhaustSelf || raw.cost.spite);
  const kind = (raw.kind === "trigger" || raw.kind === "activated")
    ? raw.kind
    : (legacyHadCost ? "activated" : "trigger");
  // costs: vervangt het oudere, vaste `cost: {spite, exhaustSelf}`-object
  // (cfr. Gamerules-specificatie.txt sectie 2f, vraag 13) door een vrije
  // lijst van kost-componenten, zodat combinaties (bv. exhaust + discard 1
  // kaart) mogelijk zijn. Migratie: bestaande effects met het oude `cost`-
  // object worden hier omgezet naar de nieuwe lijst-vorm.
  let costs;
  if (Array.isArray(raw.costs)){
    costs = raw.costs.map(normalizeCostEntry);
  } else if (raw.cost){
    costs = [];
    if (raw.cost.exhaustSelf) costs.push({ type: "ExhaustSelf", value: 1 });
    if (raw.cost.spite) costs.push({ type: "Spite", value: toNum(raw.cost.spite, 1) });
  } else {
    costs = [];
  }
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    kind: kind,
    // Trigger is enkel zinvol voor kind:"trigger" — voor kind:"activated"
    // blijft dit veld leeg (een activated ability wordt door de speler
    // geactiveerd door de costs hieronder te betalen, niet door een
    // spelgebeurtenis). De cardbuilder-UI toont het triggerveld dan ook
    // enkel voor kind:"trigger".
    trigger: (kind === "trigger" && TRIGGER_LIST.includes(raw.trigger)) ? raw.trigger : "",
    action: ACTION_LIST.includes(raw.action) ? raw.action : "",
    // damageType: enkel zinvol bij action:"Damage" en niet bij een Attack
    // (zone-afhankelijk). Anders leeg.
    damageType: (raw.action === "Damage" && !(kind === "activated" && raw.isAttack) && DAMAGE_TYPE_LIST.includes(raw.damageType)) ? raw.damageType : "",
    target: TARGET_LIST.includes(raw.target) ? raw.target : "self",
    value: toNum(raw.value, 0),
    // isAttack: markeert een activated ability specifiek als "Attack"
    // (cfr. Gamerules-specificatie.txt 2c/2e: "activated ⊃ attack" — niet
    // elke activated ability is een attack, maar een attack is er altijd
    // een). Enkel een Attack volgt de zone-afhankelijke waarde/schadetype-
    // regel en target:"opponentZone"; een gewone activated ability (bv.
    // Mosquito) gebruikt gewoon zijn eigen vaste `value`/`target`.
    isAttack: !!raw.isAttack,
    // Vrije, niet-gevalideerde condition-string (bv. "bodyShield == 0") —
    // bewust niet dichtgetimmerd zolang er geen condition-parser bestaat.
    condition: typeof raw.condition === "string" ? raw.condition : "",
    // Kost om deze activated ability te activeren (leeg voor kind:"trigger").
    // Los van actionCost/spiteCost om de kaart zelf te CASTEN.
    costs: kind === "activated" ? costs : []
  };
}

const THEME_COLOR_VAR = {
  Fire:"--t-fire", Earth:"--t-earth", Water:"--t-water",
  Sky:"--t-sky", Shadow:"--t-shadow", Light:"--t-light"
};

/* -------------------------------------------------------------------------
   freshCounters (Road to sustainability, Fase 4-vervolg 2026-09-05): stond
   tot nog toe enkel lokaal in arena.html, maar shared/game-mechanics.js
   (tickSlumberOnce) had dezelfde vorm nodig en kon de lokale, IIFE-scoped
   versie in arena.html niet aanroepen — die werd daarom eerst inline
   gehardcodeerd, wat een tweede kopie van dezelfde {white,black}-vorm
   opleverde. Hier nu één keer gedefinieerd; arena.html se lokale kopie is
   verwijderd en game-mechanics.js roept deze versie aan. ------------------- */
function freshCounters(){ return { white: 0, black: 0 }; }

function uid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "c_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,9);
}

function toNum(v, fallback){
  if (v === "" || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCard(raw){
  raw = raw || {};
  return {
    // Onbekende/toekomstige velden (bv. aangemaakt door een later bijgewerkte
    // sessie) blijven behouden, ook als DEZE sessie ze nog niet kent —
    // voorkomt dataverlies wanneer een verouderde tab nog even meeschrijft
    // naar Drive terwijl een teamgenoot al met een nieuwer schema werkt.
    // De expliciete velden hieronder overschrijven/valideren wat er ook in
    // raw stond.
    ...raw,
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    name: typeof raw.name === "string" ? raw.name : "",
    type: TYPE_LIST.includes(raw.type) ? raw.type : "Manifestation",
    theme: THEME_LIST.includes(raw.theme) ? raw.theme : "",
    location: LOCATION_LIST.includes(raw.location) ? raw.location : "",
    phase: PHASE_LIST.includes(raw.phase) ? raw.phase : "",
    status: STATUS_LIST.includes(raw.status) ? raw.status : "In Design",
    actionCost: toNum(raw.actionCost, 0),
    spiteCost: toNum(raw.spiteCost, 0),
    // Slumber: elke in-play kaart wordt geacht dit te hebben, ook zonder
    // geprinte waarde (dan geldt Slumber 0). Bepaalt hoeveel witte Time
    // Counters een kaart krijgt bij het exhausten, en dus na hoeveel acties
    // van de eigenaar ze vanzelf weer ready wordt (zie spendAction in
    // arena.html). Bij Slumber 0 gebeurt dat al bij de eerstvolgende actie
    // na het exhausten. Bewust een apart veld i.p.v. vrije tekst in
    // gameText, zodat het niet kan afwijken van wat de engine toepast.
    slumber: toNum(raw.slumber, 0),
    body: raw.body === "" || raw.body === null || raw.body === undefined ? "" : toNum(raw.body, ""),
    mind: raw.mind === "" || raw.mind === null || raw.mind === undefined ? "" : toNum(raw.mind, ""),
    soul: raw.soul === "" || raw.soul === null || raw.soul === undefined ? "" : toNum(raw.soul, ""),
    gameText: typeof raw.gameText === "string" ? raw.gameText : "",
    flavorText: typeof raw.flavorText === "string" ? raw.flavorText : "",
    image: typeof raw.image === "string" ? raw.image : "",
    notes: typeof raw.notes === "string" ? raw.notes : "",
    tags: Array.isArray(raw.tags) ? raw.tags.filter(t => typeof t === "string" && t.trim()).map(t => t.trim()) : [],
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : "",

    // --- nieuw: aanmaak-/wijzigingsmetadata. firstCreated wordt éénmalig
    // gezet (bij newCard()/duplicateCard()) en daarna nooit overschreven
    // door normalizeCard zelf. lastUpdated/lastUpdatedBy worden bijgewerkt
    // telkens een kaart effectief wijzigt (zie syncFromForm in cardbuilder).
    // Bestaande kaarten van vóór deze uitbreiding hebben firstCreated/
    // lastUpdated op null — geen historische data beschikbaar, dus bewust
    // niet gegokt op een datum.
    firstCreated: (typeof raw.firstCreated === "number") ? raw.firstCreated : (raw.firstCreated || null),
    lastUpdated: (typeof raw.lastUpdated === "number") ? raw.lastUpdated : (raw.lastUpdated || null),
    lastUpdatedBy: typeof raw.lastUpdatedBy === "string" ? raw.lastUpdatedBy : "",

    // --- nieuw: subtypes (een kaart mag er meerdere hebben), afhankelijk
    // van (het genormaliseerde) type. Getoond op de kaart als "Type - Sub1, Sub2".
    // Bewust NIET meer gefilterd tegen SUBTYPE_LIST_BY_TYPE: sinds vrij
    // toegevoegde subtypes bestaan (spec sectie 6) kent normalizeCard() de
    // customSubtypes-lijst niet (die leeft in de host-module, niet hier) —
    // een harde validatie zou elk custom subtype dus meteen terug
    // wegfilteren. De chip-UI is de facto al de gatekeeper van geldige
    // waarden; hier enkel nog opschonen (geen lege/dubbele strings).
    subtypes: (() => {
      const incoming = Array.isArray(raw.subtypes) ? raw.subtypes : (typeof raw.subtype === "string" && raw.subtype ? [raw.subtype] : []);
      const cleaned = incoming.filter(s => typeof s === "string" && s.trim()).map(s => s.trim());
      return Array.from(new Set(cleaned));
    })(),

    // --- nieuw: machine-leesbare effecten naast gameText ---
    effects: Array.isArray(raw.effects) ? raw.effects.map(normalizeEffect) : [],

    // --- nieuw: draft-metadata ---
    rarity: RARITY_LIST.includes(raw.rarity) ? raw.rarity : "",
    // Bewust default false: een kaart moet EXPLICIET vrijgegeven worden
    // voor draft, i.p.v. dat alles er per ongeluk instaat zodra het veld
    // bestaat. "Afgewerkt"-status is een voorwaarde, geen garantie.
    draftLegal: !!raw.draftLegal
  };
}

/* -------------------------------------------------------------------------
   Shuffle (Road to sustainability, Fase 1b): shuffleArray() (arena.html) en
   shuffled() (draft.html, onder die naam) waren woord-voor-woord hetzelfde
   Fisher-Yates-algoritme. shuffleArray schudt in-place en geeft dezelfde
   array terug (het gedrag dat arena.html al overal verwachtte); shuffled()
   is er nu een dunne wrapper omheen die eerst een kopie maakt, voor de
   plekken (zoals draft.html) die de invoerarray niet willen muteren. ------- */

function shuffleArray(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffled(arr){
  return shuffleArray(arr.slice());
}

/* -------------------------------------------------------------------------
   Deck-export/import (Road to sustainability, Fase 1c): het
   {name, qty, cards}-bestandsformaat werd apart opnieuw opgebouwd in
   collectie.html (exportDeck) en draft.html (exportDraftDeck), en apart
   weer ingelezen in collectie.html (importDeckFromFile) en arena.html
   (importDeckFromFile/cleanQty) — telkens met de hand overgetypt. --------- */

// Bouwt het exportformaat op uit een deck ({name, qty}) en de collectie
// (om bij elke cardId de kaartnaam mee op te slaan, puur leesbaarheid/
// documentatie in het bestand zelf — qty blijft de bron van waarheid bij
// het opnieuw inladen).
function buildDeckExportPayload(deck, collection){
  const qty = deck.qty || {};
  const cards = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([cardId, q]) => {
      const card = collection.find(c => c.id === cardId);
      return { id: cardId, name: card ? card.name : null, qty: q };
    });
  return { name: deck.name, qty, cards };
}

// Download-boilerplate (Blob → object-URL → onzichtbare <a> → klik →
// URL weer vrijgeven) — ongewijzigd overgenomen uit de drie plekken waar
// dit letterlijk hetzelfde stond.
function downloadJson(payload, filename){
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[^a-z0-9\-_]/gi, "_") + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

// Leest een geïmporteerd deck-JSON-bestand terug in {name, qty} — inclusief
// dezelfde qty-opschoning (negatief/NaN/0 eruit) die voorheen apart in
// collectie.html (inline) en arena.html (als cleanQty) stond.
function parseDeckImportPayload(json){
  const rawQty = (json && typeof json.qty === "object" && json.qty) ? json.qty : {};
  const qty = {};
  Object.entries(rawQty).forEach(([cardId, n]) => {
    const num = Math.max(0, parseInt(n) || 0);
    if (num > 0) qty[cardId] = num;
  });
  const name = (json && typeof json.name === "string" && json.name.trim()) ? json.name.trim() : "Geïmporteerd deck";
  return { name, qty };
}
