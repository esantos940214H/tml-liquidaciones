// ─────────────────────────────────────────────────────────────────────────
// Configuración de Restaurante Encino
//
// MODO LOCAL (valor por defecto: null)
//   Todo se guarda en ESTE navegador (localStorage). Sirve para empezar a
//   usarlo de inmediato en una sola computadora/tablet, pero:
//   - otros dispositivos (meseros, celulares de clientes) NO ven los datos;
//   - los pedidos en línea solo llegan si se hacen desde el mismo navegador.
//
// MODO FIREBASE (recomendado para uso real)
//   Pega aquí la configuración de un proyecto de Firebase PROPIO del
//   restaurante (no uses el de tml-liquidaciones). Con eso todos los
//   dispositivos comparten menú, órdenes, inventario y pedidos en línea.
//   Ver encino/README.md → "Pasar a modo Firebase".
// ─────────────────────────────────────────────────────────────────────────
window.ENCINO_FIREBASE_CONFIG = {
  apiKey: "AIzaSyACB1MqFgZfPcZzh205u71sbfcAe9Jv6ac",
  authDomain: "restaurante-encino.firebaseapp.com",
  projectId: "restaurante-encino",
  storageBucket: "restaurante-encino.firebasestorage.app",
  messagingSenderId: "969102111634",
  appId: "1:969102111634:web:9b41a207453e443966874b"
};
/* Ejemplo:
window.ENCINO_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "restaurante-encino.firebaseapp.com",
  projectId: "restaurante-encino",
  storageBucket: "restaurante-encino.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
*/
