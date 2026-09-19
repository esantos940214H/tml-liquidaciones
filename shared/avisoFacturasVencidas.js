// ══════════════════════════════════════════════════════════════════════════
// shared/avisoFacturasVencidas.js
// Ventana emergente avisando facturas de proveedor vencidas sin pagar, para
// que no dependa de que alguien entre a Proveedores y las vea ahí. Se carga
// con <script src="shared/avisoFacturasVencidas.js"> en cada módulo (excepto
// proveedores.html, donde ya se ve la lista completa, y operador.html, que es
// para operadores, no para quien paga facturas).
//
// Pedido explícito: debe aparecer cada vez que se entra a un módulo distinto
// mientras sigan existiendo facturas vencidas sin pagar — sin límite de una
// vez al día. En cuanto se pague o venza el plazo de todas, deja de
// aparecer solo (no hay nada que "apagar" a mano).
// ══════════════════════════════════════════════════════════════════════════
(function(){
  'use strict';

  var FIREBASE_CONFIG={apiKey:"AIzaSyDqlhREJFVFLGzz7bVlPcNl1Uba9HI3r8s",authDomain:"tml-liquidaciones.firebaseapp.com",
    projectId:"tml-liquidaciones",storageBucket:"tml-liquidaciones.firebasestorage.app",
    messagingSenderId:"268455373953",appId:"1:268455373953:web:ad359c5dbcba9f53557180"};

  function tmlGetCookie(name){
    var m=document.cookie.match('(^|;\\s*)'+name+'=([^;]*)');
    return m?decodeURIComponent(m[2]):null;
  }
  function usuarioSesionTML(){
    try{return JSON.parse(tmlGetCookie('tml_user')||'null');}catch(e){return null;}
  }
  function yaVencioLimite(fechaLimiteISO){
    return !!fechaLimiteISO&&new Date(fechaLimiteISO).getTime()<Date.now();
  }

  var u=usuarioSesionTML();
  if(!u)return; // sin sesión reconocida (pantalla de login) — no hay a quién avisarle
  if(!u.esAdmin&&(!u.permisos||!u.permisos.proveedores))return; // solo a quien puede ver Proveedores

  if(!window.firebase||!firebase.firestore){console.error('avisoFacturasVencidas: falta cargar firebase-app-compat.js y firebase-firestore-compat.js antes de este script.');return;}
  if(!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);
  var db=firebase.firestore();

  db.collection('cxpFacturas').get().then(function(snap){
    var vencidas=[];
    snap.forEach(function(doc){
      var f=doc.data();
      if(!f||!f.proveedorNombre)return; // factura dañada (sin datos) — no aplica aquí
      var bloqueada=f.estadoPago==='pendiente_pago';
      var pagada=f.estadoPago==='pagada';
      if(!bloqueada&&!pagada&&yaVencioLimite(f.fechaVencimiento))vencidas.push(f);
    });
    if(!vencidas.length)return;

    var total=vencidas.reduce(function(s,f){return s+(f.total||0);},0);
    var totalFmt='$'+total.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    var detalle=vencidas.slice(0,5).map(function(f){
      return '• '+f.proveedorNombre+' — '+('$'+(f.total||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}))+' (venció '+f.fechaVencimiento+')';
    }).join('\n');
    var extra=vencidas.length>5?'\n… y '+(vencidas.length-5)+' más.':'';

    alert('⚠️ Tienes '+vencidas.length+' factura(s) a proveedores VENCIDAS sin pagar, por un total de '+totalFmt+':\n\n'+detalle+extra+'\n\nRevísalas en Proveedores.');
  }).catch(function(e){
    console.error('avisoFacturasVencidas: no se pudo revisar facturas vencidas:',e);
  });
})();
