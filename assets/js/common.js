const defaultSite = {
  baby_name: 'Halley',
  headline: 'Una dulce espera, un amor infinito',
  parents: 'Hecho con amor para Halley y su familia',
  welcome: 'Nuestra pequeña está en camino y cada detalle elegido con cariño será parte de su historia. ♡',
  event_date: '', event_time: '', venue: '', whatsapp: ''
};

// Estado y utilidades compartidas por las páginas (sin getters: se mezclan con spread).
const babyCommon = () => ({
  site: { ...defaultSite },
  gifts: [],
  loading: true,
  errorMessage: '',
  categories: ['Todos', 'Dormitorio', 'Paseo', 'Alimentación', 'Baño', 'Ropita', 'Juguetes'],
  slug(category) { return category.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '-'); },
  mustShowCatCard(cat) { return cat !== 'Todos'; },
  safeUrl(value) { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } },
  niceDate(date) {
    if (!date) return '';
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day));
  },
  sortGifts(docs) {
    return docs.map(doc => babyFirebase.normalizeGift(doc.id, doc.data()))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
  }
});
