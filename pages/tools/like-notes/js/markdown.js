/**
 * Markdown - 轻量、安全的最小 Markdown 渲染器
 * 支持：标题、粗体/斜体/删除线、链接/图片、行内代码、围栏代码块、
 *       有序/无序列表、引用、表格、分隔线、段落；同时输出标题大纲供右侧目录使用。
 * 所有原文先做 HTML 转义，链接仅允许 http(s)/mailto/锚点/相对路径，不依赖任何 CDN。
 */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url) {
    var value = String(url || '').trim();
    if (/^(https?:\/\/|mailto:|#|\.\/|\.\.\/|\/)/i.test(value)) return escapeHtml(value);
    // 离线插入的图片使用 data URL，仅放行常见图片类型，避免脚本注入
    if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value)) return escapeHtml(value);
    // 仓库相对路径（如 assets/foo.png），禁止任何带协议的 URL
    if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) return escapeHtml(value);
    return '#';
  }

  function inline(text, used) {
    var codes = [];
    var out = escapeHtml(text).replace(/`([^`]+)`/g, function (match, code) {
      codes.push('<code>' + code + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });

    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (match, alt, url) {
      return '<img src="' + safeUrl(url) + '" alt="' + alt + '" style="max-width:100%">';
    });
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (match, label, url) {
      return '<a href="' + safeUrl(url) + '" target="_blank" rel="noopener">' + label + '</a>';
    });

    // Obsidian 风格双链：[[标题]] / [[路径|别名]]
    out = out.replace(/\[\[([^\]]+)\]\]/g, function (match, inner) {
      var parts = inner.split('|');
      var target = parts[0].trim();
      var label = (parts[1] || parts[0]).trim();
      return '<a href="#' + slug(target, used) + '" class="wikilink" title="' + escapeHtml(target) + '">' + escapeHtml(label) + '</a>';
    });

    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return out.replace(/\u0000(\d+)\u0000/g, function (match, index) {
      return codes[Number(index)] || '';
    });
  }

  function slug(text, used) {
    var base = String(text).toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
    var id = base;
    var n = 2;
    while (used[id]) {
      id = base + '-' + n;
      n++;
    }
    used[id] = true;
    return id;
  }

  function splitRow(line) {
    return String(line).replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map(function (cell) { return cell.trim(); });
  }

  function render(source) {
    var lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var toc = [];
    var used = {};
    var paragraph = [];
    var i = 0;

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push('<p>' + inline(paragraph.join(' '), used) + '</p>');
      paragraph = [];
    }

    while (i < lines.length) {
      var line = lines[i];

      // 围栏代码块
      if (/^\s*```/.test(line)) {
        flushParagraph();
        var lang = line.replace(/^\s*```/, '').trim();
        var code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        i++; // 跳过结束围栏
        html.push('<pre><code' + (lang ? ' class="lang-' + escapeHtml(lang) + '"' : '') + '>' +
          escapeHtml(code.join('\n')) + '</code></pre>');
        continue;
      }

      // 标题
      var heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        flushParagraph();
        var level = heading[1].length;
        var plain = heading[2].replace(/[*_`~]/g, '').trim();
        var id = slug(plain, used);
        toc.push({ level: level, text: plain, id: id });
        html.push('<h' + level + ' id="' + id + '">' + inline(heading[2], used) + '</h' + level + '>');
        i++;
        continue;
      }

      // 分隔线
      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
        flushParagraph();
        html.push('<hr>');
        i++;
        continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        flushParagraph();
        var quoted = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoted.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html.push('<blockquote>' + render(quoted.join('\n')).html + '</blockquote>');
        continue;
      }

      // 列表
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        flushParagraph();
        var ordered = /^\s*\d+\.\s+/.test(line);
        var items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
          i++;
        }
        var tag = ordered ? 'ol' : 'ul';
        html.push('<' + tag + '>' + items.map(function (item) {
          var task = /^\[([ xX])\]\s+(.*)$/.exec(item);
          if (task) {
            return '<li class="md-task"><input type="checkbox" disabled' +
              (task[1].toLowerCase() === 'x' ? ' checked' : '') + '>' + inline(task[2], used) + '</li>';
          }
          return '<li>' + inline(item, used) + '</li>';
        }).join('') + '</' + tag + '>');
        continue;
      }

      // 表格
      if (/^\s*\|/.test(line) && i + 1 < lines.length &&
          /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        flushParagraph();
        var header = splitRow(line);
        var rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        html.push('<table><thead><tr>' + header.map(function (cell) {
          return '<th>' + inline(cell, used) + '</th>';
        }).join('') + '</tr></thead><tbody>' + rows.map(function (row) {
          return '<tr>' + row.map(function (cell) {
            return '<td>' + inline(cell, used) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>');
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        i++;
        continue;
      }

      paragraph.push(line);
      i++;
    }
    flushParagraph();

    return { html: html.join('\n'), toc: toc };
  }

  global.Markdown = { render: render, escapeHtml: escapeHtml };
})(window);
