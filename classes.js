// Land-cover classes (spec section 3). class_id must match the pipeline's
// config.yaml. "Other" has no class_id: it is exported for review, not training.
// TODO(team): verify Tagalog (tl) and Ilocano (il) class names with a speaker.
(function (root) {
  'use strict';

  const Seasons = root.TANIMAN_SEASONS || require('./season-utils.js');

  const CLASSES = [
    { id: 1, key: 'carrot', hex: '#FF6A1F', group: 'target', name: { en: 'Carrot', tl: 'Karot', il: 'Karot' } },
    { id: 2, key: 'cabbage', hex: '#A855F7', group: 'target', name: { en: 'Cabbage', tl: 'Repolyo', il: 'Repolyo' } },
    { id: 3, key: 'potato', hex: '#FFC629', group: 'target', name: { en: 'Potato', tl: 'Patatas', il: 'Patatas' } },
    { id: 4, key: 'other_cultivated', hex: '#14B8A6', group: 'crop', needsCropName: true, name: { en: 'Other cultivated', tl: 'Ibang pananim', il: 'Sabali a mula' } },
    { id: 5, key: 'forest', hex: '#166534', group: 'noncrop', name: { en: 'Forest / woody', tl: 'Gubat / makahoy', il: 'Kabakiran / kakaykaywan' } },
    { id: 6, key: 'built_up', hex: '#DC2626', group: 'noncrop', name: { en: 'Built-up', tl: 'Gusali / kalsada', il: 'Pagbalayan / kalsada' } },
    { id: 7, key: 'bare_fallow', hex: '#A16207', group: 'noncrop', name: { en: 'Bare / fallow', tl: 'Tiwangwang / pahinga', il: 'Awan mulana / pagin-inana' } },
    { id: 8, key: 'grass_shrub', hex: '#84CC16', group: 'noncrop', name: { en: 'Grass / shrub', tl: 'Damuhan / palumpong', il: 'Ruot / babassit a kayo' } },
  ];
  const OTHER = { id: null, key: 'other', hex: '#F472B6', group: 'other', needsRemark: true, name: { en: 'Other', tl: 'Iba pa', il: 'Sabali' } };
  const ALL = [...CLASSES, OTHER];
  const RESERVED_CROP_NAMES = ['carrot', 'karot', 'cabbage', 'repolyo', 'potato', 'patatas'];
  const PROMPT_KEYS = { class: 'pickClass', cropName: 'pickCropName', remark: 'typeRemark', dates: 'pickDates' };
  const HEX_RE = /^#[0-9a-f]{6}$/i;

  function byKey(key) {
    return ALL.find(cls => cls.key === key) || null;
  }

  function byId(classId) {
    if (classId == null) return OTHER;
    return CLASSES.find(cls => cls.id === Number(classId)) || null;
  }

  function className(classId, lang = 'en') {
    const cls = byId(classId);
    return cls ? (cls.name[lang] || cls.name.en) : '';
  }

  function normalizeRemark(text) {
    return String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
  }

  function defaultDates(key) {
    const cls = byKey(key);
    return cls && cls.group === 'noncrop' ? { start: '01-01', end: '12-31' } : null;
  }

  function selectionStatus(sel, isCropResolved = () => true) {
    const cls = sel && byKey(sel.classKey);
    if (!cls) return { ready: false, missing: 'class' };
    if (cls.needsCropName && !(sel.cropId && isCropResolved(sel.cropId))) return { ready: false, missing: 'cropName' };
    if (cls.needsRemark && !normalizeRemark(sel.remark)) return { ready: false, missing: 'remark' };
    if (!Seasons.isValidMmdd(sel.start) || !Seasons.isValidMmdd(sel.end)) return { ready: false, missing: 'dates' };
    return { ready: true, missing: null };
  }

  function paintMeta(sel, isCropResolved) {
    if (!selectionStatus(sel, isCropResolved).ready) return null;
    const cls = byKey(sel.classKey);
    return {
      classId: cls.id,
      cropId: cls.needsCropName ? sel.cropId : null,
      remark: cls.needsRemark ? normalizeRemark(sel.remark).slice(0, 200) : '',
      start: sel.start,
      end: sel.end,
    };
  }

  // Plot-independent season identity, also used to group cells into fields.
  function seasonKey(meta) {
    return [
      meta.classId == null ? 'other' : meta.classId,
      meta.cropId || '',
      meta.start,
      meta.end,
      normalizeRemark(meta.remark).toLowerCase(),
    ].join('|');
  }

  function seasonId(plotIdx, meta) {
    return `p${plotIdx}|${seasonKey(meta)}`;
  }

  function seasonColor(season, catalog) {
    const cls = byId(season && season.classId) || OTHER;
    if (cls.id === 4 && season.cropId && catalog) {
      const crop = catalog.byId(season.cropId);
      if (crop && HEX_RE.test(crop.hex || '')) return crop.hex;
    }
    return cls.hex;
  }

  function legendIndex(classId) {
    return classId == null ? ALL.length - 1 : Number(classId) - 1;
  }

  function cropName(catalog, cropId, lang = 'en') {
    const crop = catalog && cropId ? catalog.byId(cropId) : null;
    return crop && crop.name ? (crop.name[lang] || crop.name.en || '') : '';
  }

  function selectionLabel(sel, catalog, lang = 'en') {
    const cls = sel && byKey(sel.classKey);
    if (!cls) return '';
    if (cls.needsCropName && sel.cropId) return cropName(catalog, sel.cropId, lang) || (cls.name[lang] || cls.name.en);
    if (cls.needsRemark) {
      const remark = normalizeRemark(sel.remark);
      return remark ? `${cls.name[lang] || cls.name.en}: ${remark}` : (cls.name[lang] || cls.name.en);
    }
    return cls.name[lang] || cls.name.en;
  }

  function selectionColor(sel, catalog) {
    const cls = sel && byKey(sel.classKey);
    if (!cls) return '#9CA3AF';
    return seasonColor({ classId: cls.id, cropId: sel.cropId }, catalog);
  }

  const api = {
    CLASSES, OTHER, ALL, RESERVED_CROP_NAMES, PROMPT_KEYS,
    byKey, byId, className, normalizeRemark, defaultDates,
    selectionStatus, paintMeta, seasonKey, seasonId,
    seasonColor, legendIndex, cropName, selectionLabel, selectionColor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_CLASSES = api;
})(typeof window !== 'undefined' ? window : globalThis);
