// Carry the observed field ID (and a legacy cycle year) through the foundation
// schema's opaque season IDs. Labels are recurring calendars, so new IDs carry
// no year: [null, fieldId].
(function (root) {
  'use strict';

  const PREFIX = 'cycle-v1|';
  const MAX_LENGTH = 400;
  const validYear = year => Number.isInteger(year) && year >= 1980 && year <= 2100;

  function encodeId(baseId, meta = {}) {
    if (typeof baseId !== 'string' || !baseId) throw new TypeError('A base season ID is required');
    let id = baseId;
    const hasYear = meta.referenceYear !== undefined && meta.referenceYear !== null;
    if (meta.fieldId != null && typeof meta.fieldId !== 'string') throw new TypeError('Field ID must be a string');
    const fieldId = meta.fieldId ? meta.fieldId : null;
    if (hasYear || fieldId !== null) {
      if (hasYear && !validYear(meta.referenceYear)) throw new RangeError('Reference year must be an integer from 1980 to 2100');
      const json = JSON.stringify([hasYear ? meta.referenceYear : null, fieldId]);
      id = `${PREFIX}${json.length}:${json}${baseId}`;
    }
    // JS counts surrogate pairs twice, making this conservative for SQL char_length.
    if (id.length > MAX_LENGTH) throw new RangeError('Season ID exceeds 400 characters');
    return id;
  }

  function decodeId(id) {
    if (typeof id !== 'string' || id.length > MAX_LENGTH || !id.startsWith(PREFIX)) return {};
    const rest = id.slice(PREFIX.length);
    const match = /^([1-9]\d*):/.exec(rest);
    if (!match) return {};
    const length = Number(match[1]);
    const start = match[0].length;
    if (!Number.isSafeInteger(length) || start + length >= rest.length) return {};
    try {
      const values = JSON.parse(rest.slice(start, start + length));
      if (!Array.isArray(values) || values.length !== 2 || !(values[0] === null || validYear(values[0]))) return {};
      if (values[1] !== null && typeof values[1] !== 'string') return {};
      if (values[0] === null && values[1] === null) return {};
      return { ...(values[0] === null ? {} : { referenceYear: values[0] }), ...(values[1] === null ? {} : { fieldId: values[1] }) };
    } catch (_) {
      return {};
    }
  }

  const api = { encodeId, decodeId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_CYCLE_META = api;
})(typeof window !== 'undefined' ? window : globalThis);
