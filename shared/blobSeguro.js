// ══════════════════════════════════════════════════════════════════════════
// shared/blobSeguro.js
//
// guardarBlobSeguro(coleccion, doc, esArray, mutar): mismo patrón que ya
// corrigió el bug real de pérdida de datos de estado/anticiposDB en
// septiembre 2026 (ver ant.html → guardar()) — relee el documento FRESCO
// de Firestore justo antes de escribir (nunca la copia que esté en
// memoria del navegador, que puede estar desactualizada si otra
// pestaña/módulo escribió en el mismo documento mientras tanto) y le
// aplica el cambio ahí mismo. Úsalo para CUALQUIER escritura a un
// documento "blob" compartido (estado/anticiposDB, ingresosDB,
// incidentesDB, cargosFlotaDB, nominaDB, arrastres, facturasUsadas, etc.
// — ver CLAUDE.md, sección "Documentos blob compartidos").
//
// mutar(freshData) recibe el objeto/arreglo recién leído y lo modifica EN
// EL LUGAR (agregar/quitar/editar) — no regresa nada; guardarBlobSeguro
// regresa el objeto/arreglo YA actualizado, para que quien llama pueda
// refrescar su variable local con el mismo dato que se guardó (evita que
// la variable en memoria se quede desincronizada de lo que en verdad ya
// quedó en Firestore).
//
// CÓMO USAR
// Cargar, DESPUÉS de definir window.FB (con get/set/getEstricto) y ANTES
// de usarlo:
//   <script src="shared/blobSeguro.js"></script>
// Ejemplo (antes: `ingresosDB.push(x); window.FB.set('estado','ingresosDB',{data:JSON.stringify(ingresosDB)});`)
//   await window.guardarBlobSeguro('estado','ingresosDB',true,function(freshDB){freshDB.push(x);});
//   ingresosDB = await window.guardarBlobSeguro('estado','ingresosDB',true,function(freshDB){freshDB.push(x);});
//
// Requiere que window.FB tenga getEstricto (a diferencia de get(), NO
// convierte un error de red/conexión en "documento vacío" — lo deja
// tronar). Si tu módulo no lo tiene definido en su bloque de
// inicialización de Firebase, agrégalo ahí:
//   getEstricto:async function(col,id){var s=await db.collection(col).doc(id).get();return s.exists?s.data():null;}
// Sin esto, un error de conexión al releer se trataría como "vacío" y se
// guardaría un documento vacío encima de datos reales de TODOS los
// operadores — exactamente el bug que esto corrige.
// ══════════════════════════════════════════════════════════════════════════
window.guardarBlobSeguro = async function (coleccion, doc, esArray, mutar) {
  if (!window.FB || !window.FB.getEstricto) {
    throw new Error('guardarBlobSeguro: falta window.FB.getEstricto en este módulo — revisa el bloque de inicialización de Firebase.');
  }
  const fresco = await window.FB.getEstricto(coleccion, doc);
  let freshData = (fresco && fresco.data != null) ? JSON.parse(fresco.data) : (esArray ? [] : {});
  if (esArray && !Array.isArray(freshData)) freshData = [];
  if (!esArray && Array.isArray(freshData)) freshData = {};
  mutar(freshData);
  await window.FB.set(coleccion, doc, { data: JSON.stringify(freshData) });
  return freshData;
};
