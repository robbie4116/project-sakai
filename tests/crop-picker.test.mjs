import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const pickerSource = await readFile(new URL('../crop-picker.js', import.meta.url), 'utf8').catch(() => '');
const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const stagingSource = await readFile(new URL('../src-tauri/scripts/prepare-dist.mjs', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.handlers = {};
    this.className = '';
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classList.contains(name) : Boolean(force);
        this.classList[enabled ? 'add' : 'remove'](name);
        return enabled;
      },
    };
    this.id = '';
    this.type = '';
    this.value = '';
    this.textContent = '';
    this._hidden = false;
    this.disabled = false;
    this.ownerDocument = null;
  }
  get hidden() { return this._hidden; }
  set hidden(value) {
    this._hidden = Boolean(value);
    if (this._hidden && this.ownerDocument && this.ownerDocument.activeElement && this.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.activeElement = null;
    }
  }
  contains(candidate) { return this === candidate || this.children.some(child => child.contains(candidate)); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.removeChild(node);
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) this.removeChild(child);
    this.children = [];
    this.textContent = '';
    this.append(...nodes);
  }
  removeChild(node) {
    if (this.ownerDocument && this.ownerDocument.activeElement && node.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.activeElement = null;
    }
    this.children = this.children.filter(child => child !== node);
    node.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  fire(type, extra = {}) {
    const event = { target: this, preventDefault() {}, ...extra };
    for (const handler of this.handlers[type] || []) handler(event);
  }
  click() {
    if (this.disabled || this.hidden) return;
    this.fire('click');
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = [];
    const testNode = node => {
      if (selector.startsWith('#') && node.id === selector.slice(1)) return true;
      if (selector.startsWith('.') && node.classList.contains(selector.slice(1))) return true;
      const action = selector.match(/^\[data-action="([^"]+)"\]$/);
      if (action && node.dataset.action === action[1]) return true;
      const cropId = selector.match(/^\[data-crop-id="([^"]+)"\]$/);
      if (cropId && node.dataset.cropId === cropId[1]) return true;
      return false;
    };
    const visit = node => {
      for (const child of node.children) {
        if (testNode(child)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function makeDom() {
  const documentElement = new Element('document');
  const byId = id => {
    if (documentElement.id === id) return documentElement;
    const visit = node => {
      for (const child of node.children) {
        if (child.id === id) return child;
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(documentElement);
  };
  const node = (tag, id, parent) => {
    const element = new Element(tag);
    element.id = id;
    parent.append(element);
    return element;
  };
  const root = node('div', 'crop-picker', documentElement);
  const targetGroup = node('section', 'crop-target-group', root);
  node('h4', 'crop-target-heading', targetGroup);
  node('div', 'crop-target-list', targetGroup);
  const otherGroup = node('section', 'crop-other-group', root);
  const otherHeading = node('div', 'crop-other-heading-row', otherGroup);
  node('h4', 'crop-other-heading', otherHeading);
  node('span', 'crop-count', otherHeading);
  node('label', 'crop-search-label', otherGroup);
  node('input', 'crop-search', otherGroup);
  node('div', 'crop-custom-list', otherGroup);
  node('div', 'crop-selected-status', otherGroup);
  node('button', 'crop-add-toggle', otherGroup);
  const form = node('form', 'crop-create-form', otherGroup);
  node('label', 'crop-name-label', form);
  node('input', 'crop-name', form);
  node('label', 'crop-color-label', form);
  node('input', 'crop-color', form);
  node('p', 'crop-name-help', form);
  node('button', 'crop-save', form);
  node('button', 'crop-cancel', form);
  node('div', 'crop-form-message', form);
  const document = {
    activeElement: null,
    createElement: tag => {
      const element = new Element(tag);
      element.ownerDocument = document;
      return element;
    },
    getElementById: byId,
  };
  const connectDocument = element => {
    element.ownerDocument = document;
    for (const child of element.children) connectDocument(child);
  };
  connectDocument(documentElement);
  return { document, root, byId };
}

function createCatalog() {
  const crops = [
    { id: 'lettuce', hex: '#22C55E', name: { en: 'Lettuce', tl: 'Letsugas', il: 'Letsugas' }, isTarget: true, isResolved: true },
    { id: 'potato', hex: '#FFC629', name: { en: 'Potato', tl: 'Patatas', il: 'Patatas' }, isTarget: true, isResolved: true },
    { id: 'carrot', hex: '#FF6A1F', name: { en: 'Carrot', tl: 'Karot', il: 'Karot' }, isTarget: true, isResolved: true },
    { id: 'crop-mango', hex: '#E9A23B', name: { en: 'Mango' }, isTarget: false, isResolved: true },
    { id: 'crop-taro', hex: '#8758A8', name: { en: 'Taro' }, isTarget: false, isResolved: true },
  ];
  return {
    all: () => crops,
    byId: id => crops.find(crop => crop.id === id) || null,
    isTarget: id => ['lettuce', 'potato', 'carrot'].includes(id),
    normalizeName: name => String(name ?? '').trim().replace(/\s+/g, ' '),
  };
}

function loadPicker({ tauri = false, onCreate = async () => ({ status: 'created', crop: null }), onSelect = () => {} } = {}) {
  const dom = makeDom();
  const window = { ...(tauri ? { __TAURI__: {} } : {}) };
  const context = { window, document: dom.document, console };
  vm.createContext(context);
  vm.runInContext(dataSource, context);
  vm.runInContext(pickerSource, context);
  const catalog = createCatalog();
  const picker = window.TANIMAN_CROP_PICKER.create({
    root: dom.root,
    catalog,
    selectedCropId: 'lettuce',
    lang: 'en',
    onCreate,
    onSelect,
  });
  picker.render({ selectedCropId: 'lettuce', lang: 'en' });
  return { ...dom, window, picker, catalog };
}

function cropButton(dom, id) {
  return dom.root.querySelector(`[data-crop-id="${id}"]`);
}

test('target crop cards stay visible while search filters only custom crops', () => {
  const dom = loadPicker();
  const targetList = dom.byId('crop-target-list');
  const customList = dom.byId('crop-custom-list');

  assert.equal(targetList.children.length, 3);
  assert.equal(customList.children.length, 2);
  const search = dom.byId('crop-search');
  search.value = 'mang';
  search.fire('input');

  assert.equal(targetList.children.length, 3);
  assert.equal(customList.children.length, 1);
  assert.equal(customList.children[0].dataset.cropId, 'crop-mango');
  assert.match(dom.byId('crop-count').textContent, /1.*2|2.*1/);
});

test('selected custom crop remains clearly indicated when search hides its card', () => {
  const dom = loadPicker();
  dom.picker.render({ selectedCropId: 'crop-mango', lang: 'en' });
  const search = dom.byId('crop-search');
  search.value = 'taro';
  search.fire('input');

  assert.equal(cropButton(dom, 'crop-mango'), null);
  assert.match(dom.byId('crop-selected-status').textContent, /Mango.*search|search.*Mango/i);
});

test('an unresolved selected ID gets a visible warning instead of disappearing from the picker', () => {
  const dom = loadPicker();
  dom.catalog.all().push({
    id: 'crop-missing', hex: '#9CA3AF', name: { en: 'Unknown crop (crop-missing)' }, isResolved: false,
  });
  dom.picker.render({ selectedCropId: 'crop-missing', lang: 'en' });

  assert.equal(cropButton(dom, 'crop-missing'), null);
  assert.match(dom.byId('crop-selected-status').textContent, /unavailable.*before painting/i);
});

test('local duplicate offers explicit selection without inserting or selecting immediately', async () => {
  const created = [];
  const selected = [];
  const dom = loadPicker({ onCreate: async (...args) => { created.push(args); return { status: 'created' }; }, onSelect: id => selected.push(id) });
  dom.byId('crop-add-toggle').click();
  const name = dom.byId('crop-name');
  name.value = '  mango  ';
  dom.byId('crop-create-form').fire('submit');

  assert.equal(created.length, 0);
  assert.equal(selected.length, 0);
  assert.match(dom.byId('crop-form-message').textContent, /already exists|duplicate/i);
  const choose = dom.root.querySelector('[data-action="select-duplicate"]');
  assert.ok(choose);
  choose.focus();
  choose.click();
  assert.deepEqual(selected, ['crop-mango']);
  assert.equal(dom.document.activeElement, cropButton(dom, 'crop-mango'));
});

test('crop selection preserves keyboard focus on the selected card after rerender', () => {
  let dom;
  dom = loadPicker({ onSelect: id => dom.picker.render({ selectedCropId: id }) });
  const button = cropButton(dom, 'crop-taro');
  button.focus();
  button.click();

  assert.equal(dom.document.activeElement, cropButton(dom, 'crop-taro'));
  assert.equal(cropButton(dom, 'crop-taro').getAttribute('aria-pressed'), 'true');
});

test('Cancel returns focus to Add crop after closing the form', () => {
  const dom = loadPicker();
  dom.byId('crop-add-toggle').click();
  const cancel = dom.byId('crop-cancel');
  cancel.focus();
  cancel.click();

  assert.equal(dom.byId('crop-create-form').hidden, true);
  assert.equal(dom.document.activeElement, dom.byId('crop-add-toggle'));
});

test('save shows loading, preserves inputs after failure, and offers a returned server duplicate', async () => {
  let resolveCreate;
  let rejectCreate;
  const selection = [];
  const dom = loadPicker({
    onCreate: () => new Promise((resolve, reject) => { resolveCreate = resolve; rejectCreate = reject; }),
    onSelect: id => selection.push(id),
  });
  dom.byId('crop-add-toggle').click();
  const name = dom.byId('crop-name');
  const color = dom.byId('crop-color');
  name.value = 'Amaranth';
  color.value = '#123ABC';
  const form = dom.byId('crop-create-form');
  form.fire('submit');
  await Promise.resolve();

  assert.equal(dom.byId('crop-save').disabled, true);
  assert.equal(dom.byId('crop-add-toggle').disabled, true);
  dom.byId('crop-add-toggle').click();
  assert.equal(form.hidden, false);
  assert.match(dom.byId('crop-save').textContent, /saving/i);
  assert.equal(name.value, 'Amaranth');
  assert.equal(color.value, '#123ABC');
  rejectCreate(new Error('network down'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.byId('crop-save').disabled, false);
  assert.equal(form.hidden, false);
  assert.equal(name.value, 'Amaranth');
  assert.equal(color.value, '#123ABC');
  assert.match(dom.byId('crop-form-message').textContent, /could not|failed|try again/i);
  assert.deepEqual(selection, []);

  dom.picker.destroy?.();
});

test('a concurrent duplicate is offered for explicit selection after create returns it', async () => {
  const selection = [];
  const dom = loadPicker({
    onCreate: async () => ({ status: 'duplicate', crop: { id: 'crop-taro', hex: '#8758A8', name: { en: 'Taro' }, isResolved: true } }),
    onSelect: id => selection.push(id),
  });
  dom.byId('crop-add-toggle').click();
  dom.byId('crop-name').value = 'Taro';
  dom.byId('crop-save').focus();
  dom.byId('crop-create-form').fire('submit');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(selection, []);
  assert.match(dom.byId('crop-form-message').textContent, /already exists|duplicate/i);
  const choose = dom.root.querySelector('[data-action="select-duplicate"]');
  assert.equal(dom.document.activeElement, choose);
  choose.click();
  assert.deepEqual(selection, ['crop-taro']);
  assert.equal(dom.document.activeElement, cropButton(dom, 'crop-taro'));
});

test('an unmatched server uniqueness conflict points workers back to crop search', async () => {
  const dom = loadPicker({ onCreate: async () => {
    throw new Error('A crop with a matching name already exists. Search the crop list to find it.');
  } });
  dom.byId('crop-add-toggle').click();
  dom.byId('crop-name').value = 'Rare Crop';
  dom.byId('crop-create-form').fire('submit');
  await new Promise(resolve => setImmediate(resolve));

  assert.match(dom.byId('crop-form-message').textContent, /search the list|find it/i);
  assert.equal(dom.byId('crop-name').value, 'Rare Crop');
});

test('an open picker re-translates validation messages when the language changes', () => {
  const dom = loadPicker();
  dom.byId('crop-add-toggle').click();
  dom.byId('crop-name').value = '';
  dom.byId('crop-name').fire('invalid');
  assert.match(dom.byId('crop-form-message').textContent, /Enter a crop name/);

  dom.picker.render({ lang: 'tl' });
  assert.match(dom.byId('crop-form-message').textContent, /Maglagay ng pangalan/);
});

test('new crop names are normalized and remain plain text in the crop list', async () => {
  const calls = [];
  const dom = loadPicker({ onCreate: async (name, hex) => {
    calls.push({ name, hex });
    return { status: 'created', crop: { id: 'crop-new', hex, name: { en: name }, isResolved: true } };
  } });
  dom.byId('crop-add-toggle').click();
  const name = dom.byId('crop-name');
  name.value = '  Amaranth\n Leaf  ';
  name.fire('input');
  dom.byId('crop-create-form').fire('submit');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(calls[0].name, 'Amaranth Leaf');
  const hostileName = '<img src=x onerror=alert(1)>';
  dom.catalog.all().push({ id: 'crop-hostile', hex: '#214365', name: { en: hostileName }, isResolved: true });
  dom.picker.render({ selectedCropId: 'crop-new', lang: 'en' });
  const hostileCard = cropButton(dom, 'crop-hostile');
  assert.ok(hostileCard);
  assert.equal(hostileCard.querySelector('.nm').textContent, hostileName);
  assert.doesNotMatch(pickerSource, /\.innerHTML\s*=/);
});

test('successful Save moves focus to the newly created crop card', async () => {
  let dom;
  dom = loadPicker({ onCreate: async (name, hex) => {
    const crop = { id: 'crop-new', hex, name: { en: name }, isResolved: true };
    dom.catalog.all().push(crop);
    dom.picker.render({ selectedCropId: crop.id });
    return { status: 'created', crop };
  } });
  dom.byId('crop-add-toggle').click();
  dom.byId('crop-name').value = 'Amaranth';
  const save = dom.byId('crop-save');
  save.focus();
  dom.byId('crop-create-form').fire('submit');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(dom.byId('crop-create-form').hidden, true);
  assert.equal(dom.document.activeElement, cropButton(dom, 'crop-new'));
});

test('suggested colors are stable for a name and a valid user override is retained', () => {
  const first = loadPicker();
  const second = loadPicker();
  for (const dom of [first, second]) {
    dom.byId('crop-add-toggle').click();
    dom.byId('crop-name').value = 'Amaranth';
    dom.byId('crop-name').fire('input');
  }
  const color = first.byId('crop-color');
  const suggestion = color.value;
  assert.equal(suggestion, second.byId('crop-color').value);
  assert.ok(['#22C55E', '#FFC629', '#FF6A1F'].includes(suggestion));

  color.value = '#123ABC';
  color.fire('input');
  first.byId('crop-name').value = 'Amaranth leaves';
  first.byId('crop-name').fire('input');
  assert.equal(color.value, '#123ABC');
});

test('name validation counts Unicode characters, with the catalog enforcing 80 characters', async () => {
  const calls = [];
  const dom = loadPicker({ onCreate: async (name, hex) => {
    calls.push(name);
    return { status: 'created', crop: { id: 'crop-unicode', hex, name: { en: name }, isResolved: true } };
  } });
  dom.byId('crop-add-toggle').click();
  const name = dom.byId('crop-name');
  const form = dom.byId('crop-create-form');
  name.value = '';
  name.fire('invalid');
  assert.match(dom.byId('crop-form-message').textContent, /enter a crop name/i);
  name.value = 'x'.repeat(81);
  form.fire('submit');
  assert.equal(calls.length, 0);
  assert.match(dom.byId('crop-form-message').textContent, /80/);

  name.value = '🍅'.repeat(80);
  name.fire('input');
  form.fire('submit');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0], '🍅'.repeat(80));
});

test('Tauri renders only the three target cards and hides custom catalog controls', () => {
  const dom = loadPicker({ tauri: true });
  assert.equal(dom.byId('crop-target-list').children.length, 3);
  assert.equal(dom.byId('crop-other-group').hidden, true);
  assert.equal(dom.byId('crop-add-toggle').hidden, true);
  assert.equal(dom.byId('crop-create-form').hidden, true);
});

test('picker control strings are translated in English, Tagalog, and Ilocano', () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(dataSource, context);
  const strings = context.window.STRINGS;
  const required = [
    'cropTargets', 'cropOtherCrops', 'cropCount', 'cropSearchLabel', 'cropSearchPlaceholder',
    'cropNoMatches', 'cropSelectedHidden', 'cropSelectedUnknown', 'cropAdd', 'cropNameLabel', 'cropNamePlaceholder',
    'cropColorLabel', 'cropNameHelp', 'cropSave', 'cropSaving', 'cropCancel', 'cropNameRequired',
    'cropNameTooLong', 'cropTargetNameExists', 'cropDuplicateExists', 'cropSelectExisting',
    'cropDuplicateSearch', 'cropCatalogUnavailable', 'cropSaveFailed', 'cropColorInvalid',
  ];
  for (const lang of ['en', 'tl', 'il']) {
    for (const key of required) {
      assert.equal(typeof strings[lang][key], 'string', `${lang}.${key} should exist`);
      assert.notEqual(strings[lang][key].trim(), '', `${lang}.${key} should not be empty`);
    }
  }
});

test('picker markup is labelled, keyboard accessible, ordered, and staged for Tauri', () => {
  assert.match(htmlSource, /id="crop-target-group"[^>]*aria-labelledby="crop-target-heading"/);
  assert.match(htmlSource, /id="crop-search-label"[^>]*for="crop-search"/);
  assert.match(htmlSource, /id="crop-name"[^>]*required[^>]*maxlength="160"/);
  assert.match(htmlSource, /id="crop-form-message"[^>]*aria-live="polite"/);
  assert.match(htmlSource, /<script src="crop-catalog\.js"><\/script>\s*<script src="crop-picker\.js"><\/script>/);
  assert.ok(htmlSource.indexOf('crop-picker.js') < htmlSource.indexOf("s1.src = 'app.js'"));
  assert.match(stagingSource, /'crop-picker\.js'/);
  assert.match(htmlSource, /id="crop-custom-list"[^>]*role="group"/);
  assert.match(stylesSource, /\.crop-custom-list\s*\{[^}]*max-height:[^}]*overflow-y:auto/s);
  assert.match(stylesSource, /@media\s*\(max-width:\s*700px\)[\s\S]*\.crop-custom-list\s*\{[^}]*max-height:/);
  assert.match(stylesSource, /\.crop-add-toggle[^}]*min-height:40px/s);
  assert.match(stylesSource, /\.crop-btn\s+\.nm\s*\{[^}]*overflow-wrap:\s*anywhere/s);
});
