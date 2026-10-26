document.addEventListener('alpine:init', () => {
  Alpine.data('giftApp', () => ({
    ...babyCommon(), query: '', category: 'Todos', onlyAvailable: false,
    selectedGift: null, successGift: null,
    reservation: { name: '', message: '', quantity: 1, submitting: false, error: '' },
    unsubscribe: null,
    async init() {
      const initialCategory = new URLSearchParams(location.search).get('categoria');
      if (this.categories.includes(initialCategory)) this.category = initialCategory;
      try {
        const { db } = babyFirebase.init();
        const siteSnap = await db.doc('config/site').get();
        if (siteSnap.exists) this.site = { ...defaultSite, ...siteSnap.data() };
        document.title = `${this.site.baby_name} · Baby Shower`;
        this.unsubscribe = db.collection('gifts').onSnapshot(snapshot => {
          this.gifts = this.sortGifts(snapshot.docs);
          this.errorMessage = '';
          this.loading = false;
        }, e => { this.errorMessage = babyFirebase.readableError(e); this.loading = false; });
      } catch (e) {
        this.errorMessage = babyFirebase.readableError(e);
        this.loading = false;
      }
    },
    async reload() {
      this.errorMessage = '';
      this.loading = true;
      try {
        const { db } = babyFirebase.init();
        const [siteSnap, giftsSnap] = await Promise.all([db.doc('config/site').get(), db.collection('gifts').get()]);
        if (siteSnap.exists) this.site = { ...defaultSite, ...siteSnap.data() };
        this.gifts = this.sortGifts(giftsSnap.docs);
      } catch (e) { this.errorMessage = babyFirebase.readableError(e); }
      finally { this.loading = false; }
    },
    get filteredGifts() {
      const term = this.query.toLocaleLowerCase('es').trim();
      return this.gifts.filter(g => (this.category === 'Todos' || g.category === this.category)
        && (!this.onlyAvailable || g.available > 0)
        && (!term || `${g.name} ${g.description} ${g.category}`.toLocaleLowerCase('es').includes(term)));
    },
    get quantityTotal() { return this.gifts.reduce((n, g) => n + Number(g.quantity), 0); },
    get reservedTotal() { return this.gifts.reduce((n, g) => n + Number(g.reserved), 0); },
    get progressPercent() { return this.quantityTotal ? Math.round(100 * this.reservedTotal / this.quantityTotal) : 0; },
    openReserve(gift) {
      if (!gift.available) return;
      this.selectedGift = gift;
      this.reservation = { name: '', message: '', quantity: 1, submitting: false, error: '' };
      document.body.classList.add('modal-open');
      this.$nextTick(() => document.getElementById('guest-name')?.focus());
    },
    closeReserve() { if (!this.reservation.submitting) { this.selectedGift = null; document.body.classList.remove('modal-open'); } },
    closeSuccess() { this.successGift = null; document.body.classList.remove('modal-open'); },
    async submitReserve() {
      if (!this.selectedGift || this.reservation.submitting) return;
      this.reservation.error = '';
      this.reservation.submitting = true;
      try {
        const { db } = babyFirebase.init();
        const guest = await babyFirebase.ensureGuest();
        const giftId = this.selectedGift.id;
        const giftName = this.selectedGift.name;
        const name = this.reservation.name.trim() || 'Anónimo', message = this.reservation.message.trim();
        const quantity = Number(this.reservation.quantity);
        if (name.length > 100 || message.length > 400) throw new Error('Revisa tu nombre o mensaje.');
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Cantidad inválida.');
        const giftRef = db.collection('gifts').doc(giftId);
        const resRef = db.collection('reservations').doc(`${giftId}_${guest.uid}`);
        await db.runTransaction(async tx => {
          const snap = await tx.get(giftRef);
          if (!snap.exists) throw new Error('Este regalito ya no está disponible.');
          const gift = snap.data();
          if (gift.unlimited !== true && Number(gift.quantity) - Number(gift.reserved) < quantity) throw new Error('No quedan suficientes unidades. Actualiza la página y elige otra cantidad.');
          tx.update(giftRef, { reserved: Number(gift.reserved) + quantity });
          tx.set(resRef, {
            gift_id: giftId, uid: guest.uid, name, message, quantity,
            created_at: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        this.successGift = giftName;
        this.selectedGift = null;
        document.body.classList.add('modal-open');
      } catch (e) { this.reservation.error = babyFirebase.readableError(e); }
      finally { this.reservation.submitting = false; }
    }
  }));
});
