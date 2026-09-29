// Capa de datos de Restaurante Encino.
// Misma API en los dos modos (ver config.js):
//   - local:    localStorage de este navegador (se sincroniza entre pestañas)
//   - firebase: Firestore, colecciones con prefijo "encino_"
// Todas las escrituras son parciales/fusionadas (merge) — nunca se reemplaza
// un documento completo ni una colección entera. Las existencias de
// inventario se mueven con incrementos atómicos (inc), no leyendo y
// reescribiendo el número, para que dos dispositivos vendiendo al mismo
// tiempo no se pisen.
(function(){
  'use strict';
  var CFG = window.ENCINO_FIREBASE_CONFIG || null;
  var MODE = (CFG && CFG.apiKey && window.firebase) ? 'firebase' : 'local';
  var PREFIX = 'encino_';
  var cache = {}, subs = {}, watching = {}, docSubs = {}, db = null;

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clean(o){ return JSON.parse(JSON.stringify(o)); } // quita undefined (Firestore lo rechaza)
  function list(c){ var m = cache[c] || {}; return Object.keys(m).map(function(k){ return m[k]; }); }
  function emit(c){
    var arr = list(c);
    (subs[c] || []).forEach(function(fn){ try { fn(arr); } catch(e){ console.error(e); } });
  }
  function emitDoc(c){
    (docSubs[c] || []).forEach(function(s){ try { s.cb((cache[c] || lsRead(c))[s.id] || null); } catch(e){ console.error(e); } });
  }
  function lsRead(c){
    try {
      var o = JSON.parse(localStorage.getItem('encino:' + c) || '{}');
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch(e){ return {}; }
  }
  function lsWrite(c, o){
    try { localStorage.setItem('encino:' + c, JSON.stringify(o)); }
    catch(e){ alert('No se pudo guardar en este navegador: ' + e.message); throw e; }
  }
  function touch(c, m){ if (watching[c]) cache[c] = m; emit(c); emitDoc(c); }

  function init(){
    if (MODE === 'firebase') {
      if (!firebase.apps.length) firebase.initializeApp(CFG);
      db = firebase.firestore();
      try { db.enablePersistence({ synchronizeTabs: true }).catch(function(){}); } catch(e){}
    } else {
      window.addEventListener('storage', function(e){
        if (!e.key || e.key.indexOf('encino:') !== 0) return;
        var c = e.key.slice(7);
        if (watching[c]) { cache[c] = lsRead(c); emit(c); }
        emitDoc(c);
      });
    }
    return Promise.resolve(MODE);
  }

  // Escucha una colección completa. cb(arreglo) en cada cambio.
  function watch(c, cb){
    (subs[c] = subs[c] || []).push(cb);
    if (watching[c]) { watching[c].then(function(){ cb(list(c)); }); return watching[c]; }
    if (MODE === 'local') {
      cache[c] = lsRead(c);
      watching[c] = Promise.resolve();
      cb(list(c));
      return watching[c];
    }
    watching[c] = new Promise(function(res){
      var first = true;
      db.collection(PREFIX + c).onSnapshot(function(snap){
        var m = {};
        snap.forEach(function(d){ m[d.id] = Object.assign({}, d.data(), { id: d.id }); });
        cache[c] = m; emit(c);
        if (first) { first = false; res(); }
      }, function(err){
        console.error('encino ' + c, err);
        if (window.onStoreError) window.onStoreError(c, err);
        if (first) { first = false; res(); }
      });
    });
    return watching[c];
  }

  // Escucha un solo documento (lo usa la página pública de pedidos).
  function watchDoc(c, id, cb){
    if (MODE === 'local') {
      (docSubs[c] = docSubs[c] || []).push({ id: id, cb: cb });
      cb(lsRead(c)[id] || null);
      return;
    }
    db.collection(PREFIX + c).doc(id).onSnapshot(function(d){ cb(d.exists ? Object.assign({}, d.data(), { id: d.id }) : null); },
      function(err){ console.error(err); });
  }

  // Firestore guarda primero en el dispositivo y luego lo sube; su promesa
  // no se cumple hasta que el servidor confirma. Con señal débil eso deja
  // la pantalla "atorada", así que se continúa a los 1.5 s (el cambio ya
  // está en cola y se sube solo). Si el servidor lo rechaza, se avisa.
  function pronto(p, c, valor){
    return new Promise(function(res){
      var fallo = false;
      p.then(function(){ res(valor); }, function(err){
        fallo = true;
        console.error('encino guardar ' + c, err);
        if (window.onStoreError) window.onStoreError(c, err, true);
      });
      setTimeout(function(){ if (!fallo) res(valor); }, 1500);
    });
  }

  function get(c, id){
    if (MODE === 'local') return Promise.resolve(lsRead(c)[id] || null);
    return db.collection(PREFIX + c).doc(id).get().then(function(d){ return d.exists ? Object.assign({}, d.data(), { id: d.id }) : null; });
  }

  // Crea o actualiza (fusiona) un documento. Devuelve el documento resultante.
  function put(c, doc){
    var id = doc.id || uid();
    var data = clean(Object.assign({}, doc, { id: id }));
    if (MODE === 'local') {
      var m = lsRead(c);
      m[id] = Object.assign({}, m[id] || {}, data);
      lsWrite(c, m); touch(c, m);
      return Promise.resolve(m[id]);
    }
    if (watching[c]) { cache[c] = cache[c] || {}; cache[c][id] = Object.assign({}, cache[c][id] || {}, data); emit(c); }
    return pronto(db.collection(PREFIX + c).doc(id).set(data, { merge: true }), c, data);
  }

  function del(c, id){
    if (MODE === 'local') {
      var m = lsRead(c); delete m[id]; lsWrite(c, m); touch(c, m);
      return Promise.resolve();
    }
    if (cache[c]) { delete cache[c][id]; emit(c); }
    return pronto(db.collection(PREFIX + c).doc(id).delete(), c);
  }

  // Suma "delta" a un campo numérico de forma atómica.
  function inc(c, id, field, delta){
    if (MODE === 'local') {
      var m = lsRead(c);
      if (!m[id]) return Promise.resolve();
      m[id][field] = Math.round(((Number(m[id][field]) || 0) + delta) * 1e6) / 1e6;
      lsWrite(c, m); touch(c, m);
      return Promise.resolve();
    }
    if (cache[c] && cache[c][id]) { cache[c][id][field] = (Number(cache[c][id][field]) || 0) + delta; emit(c); }
    var upd = {}; upd[field] = firebase.firestore.FieldValue.increment(delta);
    return pronto(db.collection(PREFIX + c).doc(id).update(upd), c);
  }

  // Folio consecutivo de tickets (transacción en Firebase para no repetir).
  function nextFolio(){
    if (MODE === 'local') {
      var n = (parseInt(localStorage.getItem('encino:folio'), 10) || 0) + 1;
      localStorage.setItem('encino:folio', String(n));
      return Promise.resolve(n);
    }
    var ref = db.collection(PREFIX + 'config').doc('folio');
    return db.runTransaction(function(t){
      return t.get(ref).then(function(d){
        var n = ((d.exists && d.data().n) || 0) + 1;
        t.set(ref, { n: n }, { merge: true });
        return n;
      });
    });
  }

  window.Store = {
    mode: MODE, init: init, uid: uid, watch: watch, watchDoc: watchDoc, get: get,
    put: put, del: del, inc: inc, nextFolio: nextFolio, list: list,
    auth: function(){ return MODE === 'firebase' ? firebase.auth() : null; }
  };
})();
