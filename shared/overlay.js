// shared/overlay.js
//
// Generieke overlay/modal-fabriek. Vervangt het 4x bijna-identieke
// choice/notice/zoom/pile-overlaypatroon dat vroeger met de hand in
// arena.html stond (element aanmaken bij eerste gebruik, "open"-klasse
// togglen, klik-buiten/Escape sluiten) — zie Road to sustainability.txt,
// Fase 3a. Puur DOM-mechaniek, geen speldomeinkennis: de content van een
// overlay (HTML opbouwen, knoppen verbinden) blijft de verantwoordelijkheid
// van de aanroeper, via de meegegeven renderContent-callback.
//
// Gebruik:
//   const zoomOverlay = createOverlayManager({
//     id: "arena-zoom-overlay",
//     mount: () => document.getElementById("view-arena"),
//     renderContent(el, state, ctx){
//       el.innerHTML = `...`;
//       el.querySelector("#x").addEventListener("click", ctx.close);
//     }
//   });
//   zoomOverlay.open({ playerIdx, zone, instanceId });  // zet state, rendert, opent
//   zoomOverlay.close();                                // sluit, leegt de state
//   zoomOverlay.render();                                // her-rendert met de HUIDIGE state
//                                                         // (bv. na een wijziging elders,
//                                                         // zonder de overlay te sluiten)
//   zoomOverlay.isOpen();                                // true/false
//   zoomOverlay.getState();                              // huidige state, of null
//
// ctx doorgegeven aan renderContent: { close(), render(), setState(next) }
//   - close(): sluit de overlay (state = null, overlay dicht).
//   - render(): her-rendert met de ongewijzigde state.
//   - setState(next): vervangt de volledige state en her-rendert — handig
//     voor een overlay die tijdens het open-staan zijn eigen state bijwerkt
//     (bv. paginering). Geen van de huidige overlays in arena.html gebruikt
//     dit vandaag, maar het kost niets om het hier al aan te bieden.
//
// Als renderContent zelf merkt dat de meegegeven state niet langer geldig
// is (bv. de gezoomde kaart bestaat niet meer, of de speler/zone is weg),
// roept het gewoon ctx.close() aan en stopt — dat ruimt netjes op zonder
// dat de aanroeper dat apart moet afhandelen.

function createOverlayManager({ id, mount, renderContent }){
  let state = null;
  let el = null;

  function ensureEl(){
    if (el && document.body.contains(el)) return el;
    el = document.getElementById(id);
    if (!el){
      el = document.createElement("div");
      el.id = id;
      const parent = typeof mount === "function" ? mount() : mount;
      parent.appendChild(el);
      el.addEventListener("pointerdown", (e) => { if (e.target === el) close(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state) close(); });
    }
    return el;
  }

  function render(){
    const node = ensureEl();
    if (!state){
      node.classList.remove("open");
      node.innerHTML = "";
      return;
    }
    node.classList.add("open");
    renderContent(node, state, {
      close,
      render,
      setState(next){ state = next; render(); },
    });
  }

  function open(initialState){
    state = initialState;
    render();
  }

  function close(){
    if (!state) return;
    state = null;
    render();
  }

  function isOpen(){ return !!state; }
  function getState(){ return state; }

  return { open, close, render, isOpen, getState };
}

if (typeof window !== "undefined"){
  window.createOverlayManager = createOverlayManager;
}
