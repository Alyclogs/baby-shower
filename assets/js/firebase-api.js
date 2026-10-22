/* Adaptador de API de Firebase; sin servidor propio ni npm.
   La seguridad no depende de este JS: depende de firestore.rules en Firebase. */
(function () {
  'use strict';
  let app, auth, db;
  const HELP = 'Configura assets/js/firebase-config.js y activa Firestore y Authentication en Firebase.';
  function init() {
    if (db) return { auth, db };
    const c = window.BABY_FIREBASE_CONFIG;
    if (!c || !c.apiKey || c.apiKey.includes('PEGA_AQUI') || !c.projectId || c.projectId === 'TU_PROYECTO' || !c.appId || c.appId.includes('PEGA_AQUI')) {
      throw new Error('Firebase aún no está configurado. ' + HELP);
    }
    if (!window.firebase) throw new Error('No cargó Firebase desde el CDN. Revisa tu conexión a Internet.');
    app = firebase.apps.length ? firebase.app() : firebase.initializeApp(c);
    auth = app.auth();
    db = app.firestore();
    return { auth, db };
  }
  function authReady() {
    init();
    return new Promise((resolve, reject) => {
      let unsubscribe = null;
      unsubscribe = auth.onAuthStateChanged(user => {
        if (unsubscribe) unsubscribe();
        resolve(user);
      }, reject);
    });
  }
  async function ensureGuest() {
    const current = await authReady();
    if (current && !current.isAnonymous) {
      throw new Error('Tu navegador tiene una sesión de administración abierta. Para reservar como invitada, usa una ventana privada.');
    }
    if (current) return current;
    const credentials = await auth.signInAnonymously();
    return credentials.user;
  }
  function readableError(error) {
    if (!error) return 'No se pudo completar la operación.';
    if (!error.code) return error.message || String(error);
    switch (error.code) {
      case 'permission-denied': return 'Firebase rechazó la operación. Verifica que hayas publicado firestore.rules y configurado el UID del administrador. Si intentas reservar otra vez el mismo regalo, solo se permite una reserva por navegador.';
      case 'auth/operation-not-allowed': return 'Habilita los métodos Anónimo y Correo/contraseña en Firebase Authentication.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found': return 'Correo o contraseña incorrectos.';
      case 'auth/too-many-requests': return 'Demasiados intentos. Vuelve a probar más tarde.';
      case 'auth/invalid-email': return 'El correo electrónico no es válido.';
      case 'unavailable': return 'No hay conexión con Firestore. Comprueba tu red.';
      default: return error.message || 'Ocurrió un error en Firebase.';
    }
  }
  function normalizeGift(id, data) {
    const quantity = Number(data.quantity || 0), reserved = Number(data.reserved || 0);
    return { ...data, id, quantity, reserved, available: Math.max(0, quantity - reserved) };
  }
  window.babyFirebase = { init, authReady, ensureGuest, readableError, normalizeGift };
})();
