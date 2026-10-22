document.addEventListener('alpine:init', () => {
  Alpine.data('homeApp', () => ({
    ...babyCommon(),
    async init() {
      try {
        const { db } = babyFirebase.init();
        const siteSnap = await db.doc('config/site').get();
        if (siteSnap.exists) this.site = { ...defaultSite, ...siteSnap.data() };
        document.title = `${this.site.baby_name} · Baby Shower`;
      } catch (e) { this.errorMessage = babyFirebase.readableError(e); }
      finally { this.loading = false; }
    },
    get whatsappUrl() { return `https://wa.me/${(this.site.whatsapp || '').replace(/\D/g, '')}`; }
  }));
});
