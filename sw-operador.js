// sw-operador.js — service worker mínimo del módulo operador.html, SOLO
// para que el navegador lo considere "instalable" como PWA (requisito de
// Chrome/Safari para el botón "Agregar a pantalla de inicio"). No cachea
// nada a propósito: este módulo depende de datos siempre frescos de
// Firestore/Cloud Functions, y build.sh ya agrega cache-busting a
// shared/*.js — cachear aquí encima solo arriesgaría dejar a un operador
// viendo una versión vieja de la página.
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { self.clients.claim(); });
self.addEventListener('fetch', function (e) { /* sin caché: deja pasar todo a la red */ });
