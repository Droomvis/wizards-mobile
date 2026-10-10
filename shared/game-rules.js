/* =========================================================================
   game-rules.js — wat een TYPE of SUBTYPE (keyword) automatisch impliceert,
   los van wat een individuele kaart in zijn eigen `effects[]` extra doet.

   Volledige achtergrond, alle open vragen en de antwoorden erop:
   zie Gamerules-specificatie.txt (naast dit bestand).

   Laad dit bestand NA shared/card-data.js (gebruikt normalizeEffect()).

   SCOPE VAN DEZE MODULE (bewust, cfr. spec vraag 4 en sectie 2d):
   - Enkel de DEFINITIE-laag: welk keyword impliceert welk(e) effect(en).
   - Geen interpreter: niets hierin voert ooit iets automatisch uit in de
     arena. getEffectiveEffects() geeft enkel een lijst kandidaten terug.
   - Geen "passive"/continue (static) abilities (bv. Bookshelf-achtige
     bescherming) — dat is kaart-specifieke vrije tekst in gameText, geen
     keyword-implicatie, en dus expliciet buiten scope van dit bestand.
   ========================================================================= */

// SUBTYPE_EFFECTS: platte naamruimte over ALLE hoofdtypes heen (een subtype-
// naam wordt gezocht ongeacht bij welk type hij hoort). Belangrijk bij het
// vrij toevoegen van nieuwe subtypes (zie Gamerules-specificatie.txt sectie
// 5/6): een nieuwe subtype-naam mag nergens anders al gebruikt worden, anders
// erft een kaart per ongeluk het effect van een gelijknamig subtype elders.
const SUBTYPE_EFFECTS = {
  // Minion (Manifestation-subtype): ALLE Minions delen precies DEZE ene,
  // uniforme Attack-ability (cfr. Gamerules-specificatie.txt sectie 2e) —
  // een ontwerper vinkt dit niet per kaart aan, het hangt volledig aan het
  // keyword. Canonieke tekst: "Cost: exhaust this card. Target: a zone
  // controlled by an opponent. Effect: deal damage equal to this Minion's
  // Body/Mind/Soul stat, naargelang de zone (Body/Mind/Soul) waarin de
  // Minion zelf bij zijn eigen controller ligt."
  //   - kind:"activated", geen trigger: exhausten door de TEGENSTANDER
  //     (bv. een verwijderingseffect) betaalt geen cost en activeert dus
  //     niets — enkel de eigenaar die er zelf voor kiest te exhausten
  //     ("aanvallen") activeert dit.
  //   - target:"opponentZone", NIET "opponentActiveWizard": het doel is een
  //     ZONE bij de tegenstander (dezelfde soort — Body/Mind/Soul — als de
  //     zone van deze Minion), niet een specifieke kaart of de Wizard
  //     rechtstreeks. Resolutie (Interpreter-specificatie, sectie 3,
  //     definitief 2026-09-29): een vaste volgorde van drie stappen —
  //     (1) de verdediger mag optioneel kaarten uit de getargette zone
  //     offeren om te blokkeren (elke geofferde kaart trekt integraal haar
  //     eigen stat van de schade af en krijgt zelf geen schade), (2) de
  //     rest gaat automatisch op het schild van dat
  //     type, (3) wat dan nog overblijft banisht automatisch 1 kaart per
  //     schadepunt, per as uit deck (Body), hand (Mind) of discard (Soul).
  //     Er is dus GEEN keuze tussen schild/sacrifice/banish.
  //     Dit is dus een apart resolutiemechanisme t.o.v. de generieke
  //     Manifestation/Destiny-schaderegel uit sectie 2c (die geldt wanneer
  //     iets schade toedient aan een SPECIFIEKE kaart-instantie, niet aan
  //     een hele zone).
  //   - Schade-waarde EN schadetype zijn zone-afhankelijk: een eigenschap
  //     van isAttack:true (spec vraag 8), niet van een generiek `value`-
  //     mechanisme — een latere interpreter leidt waarde+schadetype af uit
  //     de zone waarin deze Minion-instantie op dat moment ligt, i.p.v. de
  //     `value` hieronder te gebruiken (die staat hier enkel als geldige
  //     default/placeholder, wordt genegeerd voor een Attack).
  //
  // Flying (TOEKOMSTIG, NIET gebouwd — cfr. spec sectie 2e): een Minion met
  // het keyword Flying zou zijn Attack ALTERNATIEF mogen targetten — niet
  // enkel "een zone" (met blokkeren/schild/banish), maar ook rechtstreeks
  // een specifieke Manifestation of Destiny in een zone (direct damage via
  // het zwarte-bolletjes-systeem van 2c). Dat is bewust een
  // aparte, latere uitbreiding (een eigen SUBTYPE_EFFECTS.Flying-achtige
  // entry of een aanpassing aan de interpreter) — geen onderdeel van deze
  // module vandaag.
  Minion: [
    normalizeEffect({
      kind: "activated",
      isAttack: true,
      trigger: "",
      action: "Damage",
      target: "opponentZone",
      costs: [{ type: "ExhaustSelf" }]
    })
  ]

  // Structure (Manifestation-subtype): bewust GEEN entry. Puur flavour/
  // thematisch, geen automatisch effect (spec sectie 5).
  // Manifestation (als subtype van Burden): bewust GEEN entry. Puur
  // mechanisch/thematisch (maakt zo'n Burden target-baar als Manifestation
  // en geschikt om in een in-play zone te liggen) — geen eigen effect
  // (spec sectie 5).
};

// TYPE_EFFECTS: analoog aan SUBTYPE_EFFECTS, maar op het niveau van het
// hoofd-type zelf (card.type). Momenteel bewust volledig leeg: voor geen
// enkel basis-type (Wizard, Manifestation, Incantation, Hex, Destiny,
// Burden) bestaat er vandaag een automatisch, type-breed effect (spec
// sectie 5). Nieuwe entries toevoegen volstaat om dat later uit te breiden.
const TYPE_EFFECTS = {};

// getEffectiveEffects(card): alle automatisch geïmpliceerde effecten (type +
// subtypes) samengevoegd met de kaart-specifieke effects[]. Volgorde: type-
// niveau, dan subtype-niveau (in de volgorde van card.subtypes), dan de
// kaart zelf — puur informatief voor wie het resultaat leest, want:
//   - TRIGGER-effecten (kind:"trigger") stapelen ALTIJD, ongeacht bron —
//     geen enkele laag onderdrukt een andere (spec vraag 1/5).
//   - ACTIVATED-effecten (kind:"activated") worden hier ook gewoon
//     allemaal teruggegeven als kandidaten; een latere interpreter/UI moet
//     de speler laten KIEZEN welke ability hij met een gegeven cost-
//     betaling activeert, nooit automatisch alles tegelijk uitvoeren.
function getEffectiveEffects(card){
  if (!card) return [];
  const fromType = TYPE_EFFECTS[card.type] || [];
  const fromSubtypes = (card.subtypes || []).flatMap(s => SUBTYPE_EFFECTS[s] || []);
  return [...fromType, ...fromSubtypes, ...(card.effects || [])];
}
