// Class buttons plus the "Other" remark input. Reuses the .crop-btn styles.
(function () {
  'use strict';

  function create({ root, remarkField, remarkInput, remarkLabel, classes, onSelect, onRemark }) {
    remarkInput.addEventListener('input', () => onRemark(remarkInput.value));

    function button(cls, selected, lang) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crop-btn' + (selected ? ' on' : '');
      b.dataset.classKey = cls.key;
      b.setAttribute('aria-pressed', String(selected));
      if (selected) b.style.borderColor = cls.hex;
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = cls.hex;
      swatch.setAttribute('aria-hidden', 'true');
      const info = document.createElement('span');
      info.className = 'info';
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = cls.name[lang] || cls.name.en;
      info.append(name);
      const check = document.createElement('span');
      check.className = 'chk';
      check.textContent = selected ? '✓' : '';
      check.setAttribute('aria-hidden', 'true');
      b.append(swatch, info, check);
      b.addEventListener('click', () => onSelect(cls.key));
      return b;
    }

    function render({ classKey, remark, lang, tr }) {
      root.replaceChildren(...classes.map(cls => button(cls, cls.key === classKey, lang)));
      remarkField.hidden = classKey !== 'other';
      remarkLabel.textContent = tr('remarkLabel');
      remarkInput.placeholder = tr('remarkPlaceholder');
      if (document.activeElement !== remarkInput && remarkInput.value !== (remark || '')) {
        remarkInput.value = remark || '';
      }
    }

    return { render };
  }

  window.TANIMAN_CLASS_PICKER = { create };
})();
