document.addEventListener('alpine:init', () => {
  Alpine.data('adminApp', () => ({
    loading: true, authenticated: false, busy: false, email: '', password: '', error: '', notice: '',
    tab: 'regalos', gifts: [], reservations: [], site: { ...defaultSite },
    showGiftDialog: false, editingId: '', giftForm: {},
    security: { old_password: '', new_password: '', confirm: '' },
    get categories() { return babyCommon().categories.filter(c => c !== 'Todos'); },
    get sortedReservations() { return [...this.reservations].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); },
    async init() {
      try {
        babyFirebase.init();
        const user = await babyFirebase.authReady();
        this.authenticated = Boolean(user && !user.isAnonymous);
        if (this.authenticated) { this.email = user.email || ''; await this.refresh(); }
      } catch (e) {
        this.authenticated = false;
        this.error = babyFirebase.readableError(e);
      } finally { this.loading = false; }
    },
    async login() {
      this.busy = true; this.error = ''; this.notice = '';
      try {
        const { auth } = babyFirebase.init();
        await auth.signInWithEmailAndPassword(this.email.trim(), this.password);
        await this.refresh(); // Además valida que el UID tenga permiso en Firestore.
        this.authenticated = true;
        this.password = '';
      } catch (e) {
        this.error = babyFirebase.readableError(e);
        this.authenticated = false;
        try { await babyFirebase.init().auth.signOut(); } catch (_) { }
      } finally { this.busy = false; }
    },
    async logout() {
      try {
        await babyFirebase.init().auth.signOut();
        this.authenticated = false; this.gifts = []; this.reservations = []; this.error = ''; this.notice = '';
        this.password = '';
      } catch (e) { this.error = babyFirebase.readableError(e); }
    },
    async refresh() {
      const { db } = babyFirebase.init();
      const [giftsSnap, reservationsSnap, siteSnap] = await Promise.all([
        db.collection('gifts').get(), db.collection('reservations').get(), db.doc('config/site').get()
      ]);
      this.gifts = giftsSnap.docs.map(doc => babyFirebase.normalizeGift(doc.id, doc.data()))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
      this.reservations = reservationsSnap.docs.map(doc => ({
        id: doc.id, ...doc.data(),
        created_at: doc.data().created_at?.toDate?.()?.toISOString?.() || new Date(0).toISOString()
      }));
      this.site = { ...defaultSite, ...(siteSnap.exists ? siteSnap.data() : {}) };
    },
    async submit(operation, message) {
      this.busy = true; this.error = ''; this.notice = '';
      try {
        await operation();
        await this.refresh();
        this.notice = message;
        return true;
      } catch (e) { this.error = babyFirebase.readableError(e); return false; }
      finally { this.busy = false; }
    },
    giftImage(id) { return this.gifts.find(g => g.id === id)?.image || ''; },
    giftName(id) { return this.gifts.find(g => g.id === id)?.name || 'Regalo no encontrado'; },
    formatDate(iso) {
      return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    },
    newGift() {
      this.error = ''; this.notice = ''; this.editingId = '';
      this.giftForm = { name: '', description: '', category: 'Ropita', emoji: '🎁', image: '', quantity: 1, link: '', featured: false };
      this.showGiftDialog = true;
    },
    editGift(gift) {
      this.error = ''; this.notice = ''; this.editingId = gift.id;
      this.giftForm = { name: gift.name, description: gift.description, category: gift.category, emoji: gift.emoji, image: gift.image || '', quantity: gift.quantity, link: gift.link, featured: gift.featured };
      this.showGiftDialog = true;
    },
    // Reduce la imagen en el navegador y la guarda como data URL en el propio regalo (sin Firebase Storage).
    async pickImage(event) {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      this.error = '';
      if (!file.type.startsWith('image/')) { this.error = 'El archivo debe ser una imagen.'; return; }
      try {
        this.giftForm.image = await this.resizeImage(file, 640, 180_000);
      } catch (_) { this.error = 'No se pudo procesar la imagen. Prueba con otra.'; }
    },
    resizeImage(file, maxSide, maxBytes) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          let quality = 0.85, out = canvas.toDataURL('image/jpeg', quality);
          while (out.length > maxBytes && quality > 0.4) { quality -= 0.1; out = canvas.toDataURL('image/jpeg', quality); }
          resolve(out);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen inválida')); };
        img.src = url;
      });
    },
    async saveGift() {
      const data = { ...this.giftForm };
      data.name = data.name.trim(); data.description = data.description.trim();
      data.quantity = Number(data.quantity);
      if (!data.name || !Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 100) {
        this.error = 'Completa el nombre y usa una cantidad entre 1 y 100.'; return;
      }
      if (this.editingId && data.quantity < (this.gifts.find(g => g.id === this.editingId)?.reserved || 0)) {
        this.error = 'La cantidad no puede ser menor a las unidades ya reservadas.'; return;
      }
      const { db } = babyFirebase.init();
      const id = this.editingId;
      const ok = await this.submit(async () => {
        if (id) {
          const ref = db.collection('gifts').doc(id);
          await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw new Error('El regalo ya no existe.');
            if (Number(snap.data().reserved || 0) > data.quantity) throw new Error('No puedes reducir la cantidad por debajo de lo ya reservado.');
            tx.update(ref, data);
          });
        } else await db.collection('gifts').add({ ...data, reserved: 0 });
      }, '¡Regalito guardado correctamente!');
      if (ok) this.showGiftDialog = false;
    },
    async deleteGift(gift) {
      if (gift.reserved > 0) { this.error = 'Libera primero las reservas de este regalo antes de eliminarlo.'; return; }
      if (!window.confirm(`¿Eliminar «${gift.name}» de la lista?`)) return;
      const { db } = babyFirebase.init();
      await this.submit(() => db.runTransaction(async tx => {
        const ref = db.collection('gifts').doc(gift.id);
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('El regalo ya fue eliminado.');
        if (Number(snap.data().reserved || 0) > 0) throw new Error('Primero debes liberar sus reservas.');
        tx.delete(ref);
      }), 'Regalito eliminado.');
    },
    async cancelReservation(res) {
      if (!window.confirm(`¿Liberar la reserva de ${res.name} para «${this.giftName(res.gift_id)}»?`)) return;
      const { db } = babyFirebase.init();
      await this.submit(() => db.runTransaction(async tx => {
        const giftRef = db.collection('gifts').doc(res.gift_id);
        const resRef = db.collection('reservations').doc(res.id);
        const [gs, rs] = await Promise.all([tx.get(giftRef), tx.get(resRef)]);
        if (!gs.exists || !rs.exists) throw new Error('La reserva o el regalo ya no existe.');
        const reserved = Number(gs.data().reserved) - Number(rs.data().quantity);
        if (reserved < 0) throw new Error('Los datos de cantidades no son consistentes.');
        tx.update(giftRef, { reserved });
        tx.delete(resRef);
      }), 'Reserva liberada.');
    },
    async saveSite() {
      const { db } = babyFirebase.init();
      const fields = Object.fromEntries(Object.keys(defaultSite).map(key => [key, String(this.site[key] || '').trim()]));
      await this.submit(() => db.doc('config/site').set(fields), '¡Información del evento actualizada!');
    },
    async changePassword() {
      if (this.security.new_password !== this.security.confirm) { this.error = 'Las contraseñas nuevas no coinciden.'; return; }
      if (this.security.new_password.length < 12) { this.error = 'La nueva contraseña necesita al menos 12 caracteres.'; return; }
      const ok = await this.submit(async () => {
        const user = babyFirebase.init().auth.currentUser;
        const credentials = firebase.auth.EmailAuthProvider.credential(user.email, this.security.old_password);
        await user.reauthenticateWithCredential(credentials);
        await user.updatePassword(this.security.new_password);
      }, 'Contraseña cambiada correctamente.');
      if (ok) this.security = { old_password: '', new_password: '', confirm: '' };
    },
    async resetPassword() {
      if (!this.email) { this.error = 'Escribe primero tu correo electrónico.'; return; }
      this.busy = true; this.error = ''; this.notice = '';
      try {
        await babyFirebase.init().auth.sendPasswordResetEmail(this.email.trim());
        this.notice = 'Si el correo existe en Firebase, recibirás instrucciones para restablecer la contraseña.';
      } catch (e) { this.error = babyFirebase.readableError(e); }
      finally { this.busy = false; }
    },
    // Agrega los regalos sugeridos que aún no existan (por id), sin tocar los demás.
    async importSuggested() {
      const { db } = babyFirebase.init();
      await this.submit(async () => {
        const response = await fetch('data/regalos-extra.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('No se encontró el archivo de regalos sugeridos.');
        const { gifts } = await response.json();
        const existing = new Set(this.gifts.map(g => g.id));
        const missing = gifts.filter(g => !existing.has(g.id));
        if (!missing.length) throw new Error('Los regalos sugeridos ya están importados.');
        const batch = db.batch();
        missing.forEach(({ id, ...gift }) => batch.set(db.collection('gifts').doc(id), { ...gift, reserved: 0 }));
        await batch.commit();
      }, '¡Regalos sugeridos importados! Edita cada uno para añadir su enlace e imagen.');
    },
    async importExamples() {
      if (this.gifts.length > 0) { this.error = 'La importación solo está disponible si no tienes regalos.'; return; }
      const { db } = babyFirebase.init();
      await this.submit(async () => {
        const response = await fetch('data/regalos-ejemplo.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('No se encontró el archivo de regalos de ejemplo.');
        const sample = await response.json();
        const batch = db.batch();
        sample.gifts.forEach(g => {
          const { id, ...gift } = g;
          batch.set(db.collection('gifts').doc(id), { ...gift, reserved: 0 });
        });
        batch.set(db.doc('config/site'), sample.site);
        await batch.commit();
      }, '¡Lista de ejemplo importada! Ya puedes editarla libremente.');
    }
  }));
});
