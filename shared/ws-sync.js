// shared/ws-sync.js
//
// Gedeelde WebSocket-sync-helper: het generieke connect/reconnect/backoff/
// send-mechaniek dat vroeger met de hand in arena.html stond (mpConnect/
// mpOpenSocket/mpDisconnect/mpBroadcastState), losgetrokken van de
// speldomeinkennis (wat er precies verzonden/toegepast wordt bij een
// "arena-state"-bericht, seat-claiming, enz.) — zie Road to
// sustainability.txt, Fase 3b.
//
// Bewust NIET gebruikt door council.html's relay-verbinding (dat protocol
// is fundamenteel anders: presence/webrtc-signalering met veel
// berichttypes i.p.v. één simpele state-blob die je bij open meteen
// aanbiedt) — maar wel zo generiek opgezet dat het onderliggende connect/
// reconnect/backoff-stuk daar later voor hergebruikt zou kunnen worden,
// mocht dat de moeite lonen.
//
// Gebruik (zie arena.html voor het volledige voorbeeld):
//   const sync = createWsSync({
//     onStatus(text, cls){ ... },        // UI-statusregel bijwerken
//     onOpen(send){ send({ type: "join", ... }); },  // socket net open
//     onMessage(msg){ ... },             // geparste JSON van de server
//     onClose(){ ... },                  // socket dicht (vóór een evt. reconnect)
//   });
//   sync.connect(url);
//   sync.send({ type: "arena-state", arena });
//   sync.disconnect();
//   sync.isConnected();
//
// Reconnect: bij een onbedoelde disconnect (dus niet na een expliciete
// sync.disconnect()) probeert de helper zelf, na reconnectDelayMs (default
// 2000ms), opnieuw te verbinden met dezelfde URL — exact het gedrag dat
// arena.html al had. sync.disconnect() annuleert een eventueel lopende
// reconnect-poging. sync.send() geeft gewoon true/false terug (verstuurd of
// niet) en gooit nooit een fout — de aanroeper hoeft dus niet zelf op
// readyState/verbonden-status te controleren vóór het versturen.

function createWsSync({ onStatus, onOpen, onMessage, onClose, reconnectDelayMs = 2000 } = {}){
  let socket = null;
  let connected = false;
  let intentionalDisconnect = false;
  let reconnectTimer = null;
  let lastUrl = null;

  function status(text, cls){
    if (onStatus) onStatus(text, cls);
  }

  function send(payload){
    if (!connected || !socket || socket.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(payload)); return true; }
    catch (e){ return false; }
  }

  function openSocket(url){
    lastUrl = url;
    status("Verbinden…", "busy");
    let s;
    try { s = new WebSocket(url); }
    catch (e){ status("Ongeldig server-adres.", "err"); return; }
    socket = s;

    s.addEventListener("open", () => {
      connected = true;
      if (onOpen) onOpen(send);
    });

    s.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e){ return; }
      if (onMessage) onMessage(msg);
    });

    s.addEventListener("close", () => {
      connected = false;
      if (onClose) onClose();
      if (!intentionalDisconnect){
        status("Verbinding verbroken — opnieuw proberen…", "err");
        reconnectTimer = setTimeout(() => openSocket(lastUrl), reconnectDelayMs);
      }
    });

    s.addEventListener("error", () => {
      status("Verbindingsfout — controleer het server-adres.", "err");
    });
  }

  function connect(url){
    intentionalDisconnect = false;
    if (reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer = null; }
    openSocket(url);
  }

  function disconnect(){
    intentionalDisconnect = true;
    if (reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (socket){ try { socket.close(); } catch (e){ /* ignore */ } }
    socket = null;
    connected = false;
  }

  function isConnected(){ return connected; }

  return { connect, disconnect, send, isConnected };
}

if (typeof window !== "undefined"){
  window.createWsSync = createWsSync;
}
