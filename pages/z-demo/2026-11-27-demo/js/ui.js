/* UI 组件工厂：统一 DOM 构建、图标、弹窗、菜单与反馈，供各功能模块复用 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};

  var ICONS = {
    files: '<path d="M4 4h9l3 3v13H4z"/><path d="M7 4v4h5V4M4 20h12"/>',
    folder: '<path d="M3 6h6l2 2h10v10H3z"/>',
    folderOpen: '<path d="M3 7h6l2 2h9l-2 9H3z"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4l2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14-5L4 8"/><path d="M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2"/><path d="M20 20v-4h-4"/>',
    cloud: '<path d="M6 18a4 4 0 0 1 0-8 6 6 0 0 1 11.6-1.5A3.5 3.5 0 0 1 18 18z"/>',
    cloudOff: '<path d="M6 18a4 4 0 0 1 0-8 6 6 0 0 1 10-3"/><path d="M3 3l18 18"/>',
    download: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/>',
    upload: '<path d="M12 21V9m0 0L8 13m4-4l4 4M4 5h16"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevronRight: '<path d="M9 5l7 7-7 7"/>',
    chevronDown: '<path d="M5 9l7 7 7-7"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 6l4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    save: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-6 3-6 8"/>',
    github: '<path d="M9 20c-4 1.2-4-2-6-2.5M15 21v-3.4a3 3 0 0 0-.8-2.3c2.7-.3 5.6-1.3 5.6-6A4.7 4.7 0 0 0 18.7 5 4.4 4.4 0 0 0 18.6 2S17.5 1.6 15 3.4a12 12 0 0 0-6 0C6.5 1.6 5.4 2 5.4 2A4.4 4.4 0 0 0 5.3 5 4.7 4.7 0 0 0 4 9.3c0 4.7 2.9 5.7 5.6 6A3 3 0 0 0 9 18v3"/>',
    tag: '<path d="M3 4h8l10 10-7 7L3 11z"/><circle cx="7.5" cy="7.5" r="1"/>',
    command: '<path d="M9 6a3 3 0 1 0-3 3h3zm0 0v12m0 0a3 3 0 1 1-3-3h3zm6-12a3 3 0 1 1 3 3h-3zm0 0v12m0 0a3 3 0 1 0 3-3h-3zM9 12h6"/>',
    moon: '<path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-5L4 8"/><path d="M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2"/><path d="M20 20v-4h-4"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z"/>',
    italic: '<path d="M10 4h9M5 20h9M15 4L9 20"/>',
    code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    quote: '<path d="M7 7h4v6H7l-3-3zM15 7h4v6h-4l-3-3z"/><path d="M7 17h4M15 17h4"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16"/>',
    heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
    imagePlus: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>',
    panelLeft: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    panelRight: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    folderPlus: '<path d="M3 6h6l2 2h10v10H3z"/><path d="M12 11v5M9.5 13.5h5"/>',
    filePlus: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M12 12v6M9 15h6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
  };

  function icon(name) {
    var span = el('span', { class: 'icon' });
    span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.file) + '</svg>';
    return span;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class' || key === 'className') node.className = value;
        else if (key === 'text') node.textContent = String(value);
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key === 'dataset') Object.keys(value).forEach(function (k) { node.dataset[k] = value[k]; });
        else if (key === 'on' && typeof value === 'object') Object.keys(value).forEach(function (evt) { node.addEventListener(evt, value[evt]); });
        else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key in node && key !== 'list' && typeof value !== 'object') node[key] = value;
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) { children.forEach(function (c) { append(node, c); }); return; }
    if (children instanceof Node) { node.appendChild(children); return; }
    node.appendChild(document.createTextNode(String(children)));
  }

  function button(opts) {
    opts = opts || {};
    var cls = 'btn' + (opts.variant ? ' btn-' + opts.variant : '') + (opts.small ? ' btn-sm' : '') + (opts.icon ? ' btn-icon' : '') + (opts.class ? ' ' + opts.class : '');
    var children = [];
    if (opts.iconName) children.push(icon(opts.iconName));
    if (opts.label) children.push(opts.label);
    var b = el('button', {
      type: opts.type || 'button', class: cls, title: opts.title || null,
      disabled: !!opts.disabled, onClick: opts.onClick
    }, children);
    if (opts.i18n) b.setAttribute('data-i18n-title', opts.i18n);
    if (opts.id) b.id = opts.id;
    return b;
  }

  function iconButton(iconName, opts) {
    opts = opts || {};
    opts.iconName = iconName;
    opts.icon = true;
    return button(opts);
  }

  function input(opts) {
    opts = opts || {};
    var node = el('input', {
      type: opts.type || 'text', class: 'input' + (opts.class ? ' ' + opts.class : ''),
      placeholder: opts.placeholder || null, value: opts.value === undefined ? '' : opts.value,
      id: opts.id || null, title: opts.title || null,
      onInput: opts.onInput, onChange: opts.onChange, onKeydown: opts.onKeydown
    });
    if (opts.i18nPlaceholder) node.setAttribute('data-i18n-placeholder', opts.i18nPlaceholder);
    return node;
  }

  function select(opts) {
    opts = opts || {};
    var node = el('select', { class: 'select' + (opts.class ? ' ' + opts.class : ''), id: opts.id || null, onChange: opts.onChange });
    (opts.options || []).forEach(function (o) {
      var value = typeof o === 'string' ? o : o.value;
      var label = typeof o === 'string' ? o : o.label;
      node.appendChild(el('option', { value: value, text: label, selected: value === opts.value }));
    });
    return node;
  }

  function field(label, control, i18n) {
    var wrap = el('label', { class: 'field' });
    var lab = el('span', { class: 'field-label', text: label });
    if (i18n) lab.setAttribute('data-i18n', i18n);
    wrap.appendChild(lab);
    append(wrap, control);
    return wrap;
  }

  function badge(text, type) {
    return el('span', { class: 'badge' + (type ? ' badge-' + type : ''), text: text });
  }

  function empty(iconName, text, action) {
    return el('div', { class: 'empty' }, [icon(iconName), el('div', { text: text }), action || null]);
  }

  function segmented(items, value, onChange) {
    var root = el('div', { class: 'segmented' });
    var buttons = [];
    items.forEach(function (item) {
      var labelNode = el('span', { text: item.label });
      if (item.i18n) labelNode.setAttribute('data-i18n', item.i18n);
      var b = el('button', {
        type: 'button', class: 'seg' + (item.value === value ? ' active' : ''),
        title: item.title || null,
        onClick: function () {
          root.querySelectorAll('.seg').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          if (onChange) onChange(item.value);
        }
      }, [item.icon ? icon(item.icon) : null, labelNode]);
      buttons.push(b);
      root.appendChild(b);
    });
    return root;
  }

  /** 全屏等待蒙层：阻止一切点击，用于仓库/分支等网络请求 */
  function busy(message) {
    var label = el('div', { class: 'busy-text', text: message || '加载中…' });
    var mask = el('div', { class: 'busy-mask' }, [
      el('div', { class: 'busy-card' }, [el('div', { class: 'spinner' }), label])
    ]);
    document.body.appendChild(mask);
    return {
      root: mask,
      setMessage: function (msg) { label.textContent = msg || ''; },
      close: function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    };
  }

  var activeMenu = null;
  function closeMenu() {
    if (!activeMenu) return;
    var node = activeMenu;
    activeMenu = null;
    if (node.parentNode) node.parentNode.removeChild(node);
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onOutside(e) { if (activeMenu && !activeMenu.contains(e.target)) closeMenu(); }

  function menu(items, x, y) {
    closeMenu();
    var root = el('div', { class: 'menu' });
    items.forEach(function (item) {
      if (item === '-' || item.separator) { root.appendChild(el('div', { class: 'menu-sep' })); return; }
      var node = el('div', {
        class: 'menu-item' + (item.danger ? ' danger' : ''),
        onClick: function () { closeMenu(); if (item.onSelect) item.onSelect(); }
      }, [item.iconName ? icon(item.iconName) : null, el('span', { text: item.label })]);
      if (item.disabled) { node.style.opacity = '.4'; node.style.pointerEvents = 'none'; }
      if (item.i18n) node.querySelector('span').setAttribute('data-i18n', item.i18n);
      root.appendChild(node);
    });
    document.body.appendChild(root);
    var rect = root.getBoundingClientRect();
    root.style.left = Math.max(4, Math.min(x, global.innerWidth - rect.width - 6)) + 'px';
    root.style.top = Math.max(4, Math.min(y, global.innerHeight - rect.height - 6)) + 'px';
    activeMenu = root;
    setTimeout(function () { document.addEventListener('mousedown', onOutside, true); }, 0);
    return root;
  }

  function modal(opts) {
    opts = opts || {};
    var body = el('div', { class: 'modal-body' });
    var footer = el('div', { class: 'modal-footer' });
    var titleNode = el('div', { class: 'modal-title', text: opts.title || '' });
    var closeBtn = iconButton('close', { small: true, class: 'modal-close', onClick: function () { instance.close(); } });
    var root = el('div', { class: 'modal' + (opts.wide ? ' modal-wide' : '') + (opts.small ? ' modal-sm' : '') + (opts.class ? ' ' + opts.class : '') }, [
      el('div', { class: 'modal-header' }, [titleNode, closeBtn]),
      body, footer
    ]);
    var mask = el('div', { class: 'modal-mask', onMousedown: function (e) { if (e.target === mask) instance.close(); } }, [root]);
    var instance = {
      root: root, mask: mask, body: body, footer: footer, title: titleNode,
      setTitle: function (t) { titleNode.textContent = t; },
      close: function () {
        document.removeEventListener('keydown', onKey);
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        if (opts.onClose) opts.onClose();
      }
    };
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); instance.close(); } }
    document.addEventListener('keydown', onKey);
    append(body, opts.content);
    append(footer, opts.actions);
    document.body.appendChild(mask);
    if (opts.focus) opts.focus.focus();
    return instance;
  }

  function confirmMessage(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      var m = modal({
        title: opts.title || '', small: true,
        content: el('div', { text: message }),
        actions: [
          button({ label: opts.cancelLabel || '取消', onClick: function () { finish(false); } }),
          button({ label: opts.okLabel || '确定', variant: opts.danger ? 'danger' : 'primary', onClick: function () { finish(true); } })
        ],
        onClose: function () { if (!done) resolve(false); }
      });
      function finish(value) { done = true; m.close(); resolve(value); }
    });
  }

  function promptMessage(message, value, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var fieldInput = input({ value: value === undefined ? '' : value });
      var done = false;
      var m = modal({
        title: opts.title || '', small: true, focus: fieldInput,
        content: [el('div', { text: message }), el('div', { style: { marginTop: '10px' } }, [fieldInput])],
        actions: [
          button({ label: opts.cancelLabel || '取消', onClick: function () { finish(null); } }),
          button({ label: opts.okLabel || '确定', variant: 'primary', onClick: function () { finish(fieldInput.value); } })
        ],
        onClose: function () { if (!done) resolve(null); }
      });
      function finish(v) { done = true; m.close(); resolve(v); }
      fieldInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') finish(fieldInput.value); });
    });
  }

  function toast(message, type, duration) {
    var stack = document.querySelector('.toast-stack');
    if (!stack) { stack = el('div', { class: 'toast-stack' }); document.body.appendChild(stack); }
    var node = el('div', { class: 'toast' + (type ? ' toast-' + type : ''), text: message });
    stack.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .25s';
      node.style.opacity = '0';
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 260);
    }, duration || 3000);
    return node;
  }

  function dropdown(items, opts) {
    opts = opts || {};
    var list = el('div', { class: 'dropdown-list' });
    var root = el('div', { class: 'dropdown' }, [opts.trigger, list]);
    function show() {
      list.innerHTML = '';
      var entries = typeof items === 'function' ? items() : items;
      if (!entries.length) list.appendChild(el('div', { class: 'dropdown-empty', text: opts.emptyText || '无结果' }));
      entries.forEach(function (item) {
        var value = typeof item === 'string' ? item : item.value;
        var label = typeof item === 'string' ? item : item.label;
        list.appendChild(el('div', {
          class: 'dropdown-item' + (value === (opts.value && opts.value()) ? ' active' : ''),
          text: label, onMousedown: function (e) { e.preventDefault(); hide(); if (opts.onSelect) opts.onSelect(value); }
        }));
      });
      list.hidden = false;
    }
    function hide() { list.hidden = true; }
    opts.trigger.addEventListener('click', function (e) { e.stopPropagation(); if (list.hidden) show(); else hide(); });
    document.addEventListener('click', hide);
    list.hidden = true;
    return { root: root, show: show, hide: hide, list: list };
  }

  App.UI = {
    el: el, icon: icon, button: button, iconButton: iconButton, input: input, select: select,
    field: field, badge: badge, empty: empty, segmented: segmented, menu: menu, closeMenu: closeMenu,
    modal: modal, confirm: confirmMessage, prompt: promptMessage, toast: toast, dropdown: dropdown,
    busy: busy
  };
})(window);
