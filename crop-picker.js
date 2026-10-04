// Accessible crop picker UI. Catalog validation and all Supabase access stay in crop-catalog.js.
(function () {
  'use strict';

  const FALLBACK_HEX = '#9CA3AF';
  const SUGGESTED_COLORS = ['#2563EB', '#C026D3', '#0891B2', '#BE123C', '#4F46E5', '#0F766E'];

  function create(options) {
    const root = options.root;
    const catalog = options.catalog;
    const isTauri = Boolean(window.__TAURI__);
    const targetGroup = root.querySelector('#crop-target-group');
    const targetList = root.querySelector('#crop-target-list');
    const otherGroup = root.querySelector('#crop-other-group');
    const targetHeading = root.querySelector('#crop-target-heading');
    const otherHeading = root.querySelector('#crop-other-heading');
    const count = root.querySelector('#crop-count');
    const customList = root.querySelector('#crop-custom-list');
    const selectedStatus = root.querySelector('#crop-selected-status');
    const addToggle = root.querySelector('#crop-add-toggle');
    const form = root.querySelector('#crop-create-form');
    const nameInput = root.querySelector('#crop-name');
    const colorInput = root.querySelector('#crop-color');
    const nameLabel = root.querySelector('#crop-name-label');
    const colorLabel = root.querySelector('#crop-color-label');
    const nameHelp = root.querySelector('#crop-name-help');
    const saveButton = root.querySelector('#crop-save');
    const cancelButton = root.querySelector('#crop-cancel');
    const formMessage = root.querySelector('#crop-form-message');

    const state = {
      selectedCropId: options.selectedCropId || '',
      lang: options.lang || 'en',
      formOpen: false,
      saving: false,
      colorTouched: false,
      duplicateCrop: null,
      messageKey: '',
      messageValues: {},
      messageKind: 'status',
    };

    function strings() {
      return (window.STRINGS && (window.STRINGS[state.lang] || window.STRINGS.en)) || {};
    }

    function tr(key, values = {}) {
      const source = strings();
      let value = source[key] || (window.STRINGS && window.STRINGS.en && window.STRINGS.en[key]) || key;
      for (const [name, replacement] of Object.entries(values)) {
        value = value.replaceAll(`{${name}}`, String(replacement));
      }
      return value;
    }

    function normalizeName(name) {
      if (catalog && typeof catalog.normalizeName === 'function') return catalog.normalizeName(name);
      return String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
    }

    function nameKey(name) {
      return normalizeName(name).toLowerCase();
    }

    function displayName(crop) {
      if (!crop) return '';
      return crop.name && (crop.name[state.lang] || crop.name.en) || `Unknown crop (${crop.id})`;
    }

    function isTarget(crop) {
      return Boolean(crop && (catalog.isTarget ? catalog.isTarget(crop.id) : crop.isTarget));
    }

    function validHex(hex) {
      return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex);
    }

    function crops() {
      return (catalog && typeof catalog.all === 'function' ? catalog.all() : []) || [];
    }

    function resolved(crop) {
      return Boolean(crop && crop.isResolved !== false);
    }

    function focusCrop(cropId) {
      const cropButton = [...root.querySelectorAll('.crop-btn')].find(button => button.dataset.cropId === cropId);
      const target = cropButton || addToggle;
      if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    }

    function focusDuplicateChoice() {
      const choice = root.querySelector('[data-action="select-duplicate"]');
      const target = choice || nameInput;
      if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    }

    function targetCrops() {
      return crops().filter(crop => isTarget(crop) && resolved(crop));
    }

    function customCrops() {
      return crops().filter(crop => !isTarget(crop) && resolved(crop));
    }

    function selectedCrop() {
      const list = crops();
      return list.find(crop => crop.id === state.selectedCropId) ||
        (catalog && typeof catalog.byId === 'function' ? catalog.byId(state.selectedCropId) : null);
    }

    function suggestedColor(name) {
      const normalized = normalizeName(name).toLowerCase();
      let hash = 0;
      for (const char of normalized) hash = ((hash * 31) + char.codePointAt(0)) >>> 0;
      const used = new Set(crops().map(crop => String(crop.hex || '').toUpperCase()).filter(validHex));
      const available = SUGGESTED_COLORS.filter(hex => !used.has(hex));
      const palette = available.length ? available : SUGGESTED_COLORS;
      return palette[hash % palette.length];
    }

    function matchingCrop(name) {
      const key = nameKey(name);
      if (!key) return null;
      const target = targetCrops().find(crop =>
        Object.values(crop.name || {}).some(value => nameKey(value) === key));
      if (target) return { crop: target, isTarget: true };
      const custom = customCrops().find(crop => nameKey(crop.name && crop.name.en) === key);
      return custom ? { crop: custom, isTarget: false } : null;
    }

    function clearMessage() {
      state.messageKey = '';
      state.messageValues = {};
      state.messageKind = 'status';
      state.duplicateCrop = null;
    }

    function createButton(crop, isSelected, action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'crop-btn' + (isSelected ? ' on' : '');
      button.dataset.cropId = crop.id;
      button.setAttribute('aria-pressed', String(isSelected));
      if (action) button.dataset.action = action;
      if (isSelected) button.style.borderColor = validHex(crop.hex) ? crop.hex : FALLBACK_HEX;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = validHex(crop.hex) ? crop.hex : FALLBACK_HEX;
      swatch.setAttribute('aria-hidden', 'true');
      const info = document.createElement('span');
      info.className = 'info';
      const label = document.createElement('span');
      label.className = 'nm';
      label.textContent = displayName(crop);
      info.append(label);
      const check = document.createElement('span');
      check.className = 'chk';
      check.textContent = isSelected ? '✓' : '';
      check.setAttribute('aria-hidden', 'true');
      button.append(swatch, info, check);
      button.addEventListener('click', () => {
        const shouldRestoreFocus = document.activeElement === button;
        if (action === 'select-duplicate') {
          state.formOpen = false;
          clearMessage();
          options.onSelect(crop.id);
          render();
          if (shouldRestoreFocus) focusCrop(crop.id);
          return;
        }
        options.onSelect(crop.id);
        if (shouldRestoreFocus) focusCrop(crop.id);
      });
      return button;
    }

    function renderTargets() {
      targetHeading.textContent = tr('cropTargets');
      targetList.replaceChildren(...targetCrops().map(crop =>
        createButton(crop, crop.id === state.selectedCropId)));
    }

    function renderCustom() {
      const list = customCrops();
      otherHeading.textContent = tr('cropOtherCrops');
      count.textContent = tr('cropCount', { shown: list.length, total: list.length });
      customList.replaceChildren(...list.map(crop =>
        createButton(crop, crop.id === state.selectedCropId)));
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'crop-empty';
        empty.textContent = tr('cropNoCrops');
        customList.append(empty);
      }

      const selected = selectedCrop();
      const selectedIsUnknown = selected && !resolved(selected);
      selectedStatus.textContent = selectedIsUnknown
        ? tr('cropSelectedUnknown', { name: displayName(selected) })
        : '';
      selectedStatus.hidden = !selectedStatus.textContent;
    }

    function renderDuplicate() {
      if (!state.duplicateCrop) return;
      const action = createButton(state.duplicateCrop, false, 'select-duplicate');
      action.classList.add('crop-duplicate-choice');
      const choiceText = document.createElement('span');
      choiceText.className = 'crop-duplicate-action';
      choiceText.textContent = tr('cropSelectExisting');
      action.append(choiceText);
      formMessage.append(action);
    }

    function renderForm() {
      form.hidden = !state.formOpen || isTauri;
      addToggle.hidden = isTauri;
      addToggle.textContent = tr('cropAdd');
      addToggle.setAttribute('aria-expanded', String(state.formOpen));
      addToggle.disabled = state.saving;
      if (!state.formOpen || isTauri) {
        formMessage.replaceChildren();
        formMessage.textContent = '';
        return;
      }
      nameLabel.textContent = tr('cropNameLabel');
      colorLabel.textContent = tr('cropColorLabel');
      nameHelp.textContent = tr('cropNameHelp');
      nameInput.placeholder = tr('cropNamePlaceholder');
      nameInput.required = true;
      // maxlength counts UTF-16 code units; the catalog and database count
      // Unicode characters. Let the submit validator enforce the exact limit.
      nameInput.maxLength = 160;
      colorInput.type = 'color';
      colorInput.value = validHex(colorInput.value) ? colorInput.value : suggestedColor(nameInput.value);
      saveButton.type = 'submit';
      saveButton.disabled = state.saving;
      saveButton.textContent = state.saving ? tr('cropSaving') : tr('cropSave');
      cancelButton.type = 'button';
      cancelButton.disabled = state.saving;
      cancelButton.textContent = tr('cropCancel');
      formMessage.replaceChildren();
      formMessage.textContent = state.messageKey ? tr(state.messageKey, state.messageValues) : '';
      formMessage.className = 'crop-form-message' + (state.messageKind === 'error' ? ' is-error' : '');
      formMessage.setAttribute('role', state.messageKind === 'error' ? 'alert' : 'status');
      formMessage.setAttribute('aria-live', 'polite');
      renderDuplicate();
    }

    function render() {
      targetGroup.hidden = false;
      otherGroup.hidden = isTauri;
      renderTargets();
      if (!isTauri) renderCustom();
      renderForm();
    }

    function showMessage(key, values, kind = 'error') {
      state.messageKey = key;
      state.messageValues = values || {};
      state.messageKind = kind;
    }

    function setDuplicate(match) {
      state.duplicateCrop = match.crop;
      showMessage(match.isTarget ? 'cropTargetNameExists' : 'cropDuplicateExists', {}, 'status');
      render();
      focusDuplicateChoice();
    }

    function validateForm(name, hex) {
      const normalized = normalizeName(name);
      if (!normalized) return { error: 'cropNameRequired' };
      if ([...normalized].length > 80) return { error: 'cropNameTooLong' };
      if (!validHex(hex)) return { error: 'cropColorInvalid' };
      const match = matchingCrop(normalized);
      if (match) return { match };
      return { name: normalized, hex };
    }

    async function save(event) {
      event.preventDefault();
      if (state.saving || isTauri) return;
      state.formOpen = true;
      clearMessage();
      const result = validateForm(nameInput.value, colorInput.value);
      if (result.error) {
        showMessage(result.error);
        render();
        return;
      }
      if (result.match) {
        setDuplicate(result.match);
        return;
      }
      if (typeof options.onCreate !== 'function') {
        showMessage('cropCatalogUnavailable');
        render();
        return;
      }

      state.saving = true;
      render();
      try {
        const created = await options.onCreate(result.name, result.hex);
        if (created && created.status === 'duplicate' && created.crop) {
          state.saving = false;
          state.duplicateCrop = created.crop;
          showMessage('cropDuplicateExists', {}, 'status');
          render();
          focusDuplicateChoice();
          return;
        }
        if (!created || created.status !== 'created' || !created.crop) {
          throw new Error('Invalid crop create result');
        }
        state.saving = false;
        state.formOpen = false;
        nameInput.value = '';
        state.colorTouched = false;
        colorInput.value = suggestedColor('');
        clearMessage();
        render();
        focusCrop(created.crop.id);
      } catch (error) {
        state.saving = false;
        const message = String(error && error.message || '').toLowerCase();
        if (message.includes('matching name') || message.includes('duplicate')) {
          showMessage('cropDuplicateSearch');
        } else {
          showMessage(message.includes('unavailable') || message.includes('offline')
            ? 'cropCatalogUnavailable'
            : 'cropSaveFailed');
        }
        render();
      }
    }

    addToggle.addEventListener('click', () => {
      if (state.saving) return;
      state.formOpen = !state.formOpen;
      if (state.formOpen) {
        clearMessage();
        if (!state.colorTouched) colorInput.value = suggestedColor(nameInput.value);
      }
      render();
      if (state.formOpen && typeof nameInput.focus === 'function') nameInput.focus();
    });
    nameInput.addEventListener('input', () => {
      if (!state.colorTouched) colorInput.value = suggestedColor(nameInput.value);
      if (state.messageKey) clearMessage();
      renderForm();
    });
    nameInput.addEventListener('invalid', event => {
      event.preventDefault();
      if (state.saving) return;
      state.formOpen = true;
      showMessage('cropNameRequired');
      renderForm();
    });
    colorInput.addEventListener('input', () => { state.colorTouched = true; });
    colorInput.addEventListener('change', () => { state.colorTouched = true; });
    form.addEventListener('submit', save);
    cancelButton.addEventListener('click', () => {
      if (state.saving) return;
      state.formOpen = false;
      state.colorTouched = false;
      nameInput.value = '';
      colorInput.value = suggestedColor('');
      clearMessage();
      render();
      addToggle.focus({ preventScroll: true });
    });

    render();
    return {
      render(next = {}) {
        if (Object.prototype.hasOwnProperty.call(next, 'selectedCropId')) state.selectedCropId = next.selectedCropId || '';
        if (Object.prototype.hasOwnProperty.call(next, 'lang')) state.lang = next.lang || 'en';
        render();
      },
      destroy() {},
    };
  }

  window.TANIMAN_CROP_PICKER = { create };
})();
