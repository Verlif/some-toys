/**
 * someToys 导航页生成脚本
 *
 * 扫描 pages/ 目录，生成 index.html。
 *
 * 规则：
 *   1. 单个页面：目录中的 .html 文件 = 一个单文件作品。
 *   2. 项目文件夹：只要文件夹里存在 index.html，这个文件夹就是一个「单项目」，
 *      文件夹名 = 项目名，index.html = 该项目的主页面。
 *   3. 分组文件夹：文件夹里没有 index.html，就当作分组用，里面的内容会被递归收录，
 *      分组可以任意层级嵌套。
 *
 * 可选元数据（写在页面 <head> 里）：
 *   <title>项目名</title>
 *   <meta name="description" content="一句话介绍">
 *   <meta name="date" content="2025-01-31">   也可用 article:modified_time
 *   <meta name="tags" content="标签1, 标签2">  也可用 keywords
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---------- 配置 ----------

const pagesDir = 'pages';
const templatePath = 'templates/nav-template.html';
const outputFile = 'index.html';

const site = {
  owner: 'Verlif',
  siteTitle: 'someToys',
  bio: 'AI 单页面作品集',
};

// 图标映射：分组名 / 项目名 / 文件名包含关键词时使用对应图标（先匹配到的优先）
const iconMap = {
  game: 'fa-gamepad',
  小游戏: 'fa-gamepad',
  游戏: 'fa-gamepad',
  tool: 'fa-wrench',
  工具: 'fa-wrench',
  实用: 'fa-wrench',
  picture: 'fa-image',
  image: 'fa-image',
  图片: 'fa-image',
  图像: 'fa-image',
  demo: 'fa-flask',
  blog: 'fa-pen-fancy',
  博客: 'fa-pen-fancy',
  ai: 'fa-robot',
  介绍: 'fa-circle-info',
  about: 'fa-circle-info',
};
const defaultIcon = 'fa-cube';

// ---------- 基础工具 ----------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pickIcon(name) {
  const lower = String(name).toLowerCase();
  const key = Object.keys(iconMap).find(k => lower.includes(k.toLowerCase()));
  return key ? iconMap[key] : defaultIcon;
}

/** 编码 URL 路径，保留 / 分隔符 */
function encodeUrl(relativePath) {
  return relativePath.split(/[\\/]/).map(encodeURIComponent).join('/');
}

function isHtml(name) {
  return /\.html?$/i.test(name);
}

/** 读取 HTML 文本，去掉可能存在的 BOM */
function readHtml(absolutePath, label) {
  try {
    return fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    console.warn(`  无法读取 ${label}：${e.message}`);
    return '';
  }
}

/** 读取文件里第一个匹配的 meta content */
function readMeta(content, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `<meta[^>]*(?:name|property)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
      'i'
    );
    const reAlt = new RegExp(
      `<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${escaped}["']`,
      'i'
    );
    const m = content.match(re) || content.match(reAlt);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

function readTitle(content, fallback) {
  const m = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return title || fallback;
}

/**
 * 从 HTML 里粗略抽取一段正文作为描述兜底。
 * 只取 body 开头的一小段纯文本，先剥掉脚本、样式和常见的界面元素。
 */
function extractDescription(content) {
  let body = content.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  body = body.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  body = body.replace(/<(nav|header|footer|aside|svg|canvas|button|select|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  body = body.replace(/<!--[\s\S]*?-->/g, ' ');
  body = body.replace(/<[^>]+>/g, ' ');
  body = body
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (body.length < 8) return '';

  // 优先截到第一个句末标点，读起来更像一句介绍
  const stop = body.search(/[。！？!?；;]/);
  if (stop >= 8 && stop < 80) return body.slice(0, stop + 1);

  return body.length > 58 ? `${body.slice(0, 58)}…` : body;
}

/** 格式化文件大小 */
function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const fixed = i === 0 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1);
  return `${fixed} ${units[i]}`;
}

/** 当前日期（UTC），格式 YYYY-MM-DD */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** 取某个路径最近一次 git 提交日期；拿不到就用今天 */
function lastCommitDate(absolutePath) {
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%ad', '--date=format:%Y-%m-%d', '--', absolutePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch (e) {
    /* 非 git 环境或没有历史提交 */
  }
  try {
    return fs.statSync(absolutePath).mtime.toISOString().slice(0, 10);
  } catch (e) {
    return today();
  }
}

// ---------- 扫描 pages/ ----------

/** 递归累计目录里所有文件的大小 */
function totalSize(dirPath) {
  let size = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) size += totalSize(full);
      else if (entry.isFile()) size += fs.statSync(full).size;
    } catch (e) {
      /* 忽略读不到的条目 */
    }
  }
  return size;
}

/** 递归统计目录里的 html 页面数 */
function countPages(dirPath, recursive = true) {
  let count = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isFile() && isHtml(entry.name)) count++;
    else if (recursive && entry.isDirectory()) count += countPages(full, true);
  }
  return count;
}

/** 从 html 文件构建一个页面项 */
function buildPage(absolutePath, urlPath, fallbackName) {
  const content = readHtml(absolutePath, absolutePath);

  let size = 0;
  try {
    size = fs.statSync(absolutePath).size;
  } catch (e) {
    /* ignore */
  }

  const description =
    readMeta(content, ['description', 'og:description']) || extractDescription(content);

  return {
    kind: 'page',
    name: readTitle(content, fallbackName),
    rawName: fallbackName,
    description,
    url: encodeUrl(urlPath),
    icon: pickIcon(fallbackName),
    size,
    date: readMeta(content, ['date', 'article:modified_time']) || lastCommitDate(absolutePath),
    pages: 1,
  };
}

/** 从项目文件夹（含 index.html）构建一个项目项 */
function buildProject(dirPath, dirName, urlDirPath) {
  const indexPath = path.join(dirPath, 'index.html');
  const content = readHtml(indexPath, indexPath);

  const description =
    readMeta(content, ['description', 'og:description']) || extractDescription(content);

  return {
    kind: 'project',
    name: readTitle(content, dirName),
    rawName: dirName,
    description,
    url: `${encodeUrl(urlDirPath)}/index.html`,
    icon: pickIcon(dirName),
    size: totalSize(dirPath),
    date: lastCommitDate(indexPath),
    pages: countPages(dirPath, true),
  };
}

/**
 * 递归扫描目录
 * @returns {{items: Array, sections: Array}}
 */
function scan(dirPath, urlPath, dirName) {
  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'));

  const files = entries
    .filter(e => e.isFile() && isHtml(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  const dirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  const items = [];
  const sections = [];

  // 当前层级里的单文件页面
  for (const name of files) {
    items.push(
      buildPage(
        path.join(dirPath, name),
        `${urlPath}/${name}`,
        name.replace(/\.html?$/i, '')
      )
    );
  }

  // 子文件夹：有 index.html → 单项目；没有 → 分组
  for (const name of dirs) {
    const childPath = path.join(dirPath, name);
    const childUrl = `${urlPath}/${name}`;

    if (fs.existsSync(path.join(childPath, 'index.html'))) {
      items.push(buildProject(childPath, name, childUrl));
      continue;
    }

    const child = scan(childPath, childUrl, name);
    const count = child.items.length + child.sections.reduce((sum, s) => sum + s.count, 0);

    if (child.items.length + child.sections.length === 0) {
      console.warn(`  跳过空文件夹：${childUrl}`);
      continue;
    }

    sections.push({
      kind: 'group',
      name,
      icon: pickIcon(name),
      id: '',
      url: encodeUrl(`${childUrl}/`),
      oneliner: '',
      count,
      items: child.items,
      sections: child.sections,
    });
  }

  return { items, sections };
}

// ---------- 渲染 ----------

function renderCard(item) {
  const meta = [];
  meta.push(
    `<span class="meta-item meta-size"><i class="fas fa-database"></i>${formatSize(item.size)}</span>`
  );
  meta.push(
    `<span class="meta-item meta-date" data-iso="${escapeHtml(item.date)}"><i class="fas fa-clock"></i>${escapeHtml(
      item.date
    )}</span>`
  );
  if (item.kind === 'project') {
    meta.push(
      `<span class="meta-item meta-pages"><i class="fas fa-layer-group"></i>共 ${item.pages} 页</span>`
    );
  }

  const searchKey = [item.name, item.description, item.rawName, item.tags]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return `<div class="card${item.description ? ' has-more' : ''}" data-name="${escapeHtml(searchKey)}" data-kind="${item.kind}">
  <a class="card-link" href="${item.url}" target="_blank" rel="noopener" title="${escapeHtml(item.name)}">
    <span class="card-head">
      <span class="card-icon"><i class="fas ${item.icon}"></i></span>
      <span class="card-title">${escapeHtml(item.name)}</span>
    </span>
    ${item.description ? `<span class="card-desc">${escapeHtml(item.description)}</span>` : ''}
    <span class="card-meta">${meta.join('')}</span>
  </a>
  ${item.kind === 'project' ? '<span class="card-tag">项目</span>' : ''}
  ${item.description ? `<button class="card-more" type="button" title="查看完整介绍"><i class="fas fa-ellipsis"></i></button>` : ''}
</div>`;
}

function renderSection(section, depth) {
  const heading = depth === 0 ? 'h2' : 'h3';
  const children = [
    ...section.items.map(renderCard),
    ...section.sections.map(child => renderSection(child, depth + 1)),
  ].join('\n');

  return `<section class="group" id="${section.id}" data-group="${section.id}" data-count="${section.count}">
  <${heading} class="group-head">
    <button class="group-toggle" type="button" aria-expanded="true" aria-controls="${section.id}-body">
      <i class="fas fa-chevron-down group-chevron"></i>
      <i class="fas ${section.icon} group-icon"></i>
      <span class="group-name">${escapeHtml(section.name)}</span>
    </button>
    <span class="group-count" data-total="${section.count}">${section.count}</span>
  </${heading}>
  <div class="group-body" id="${section.id}-body">
    <div class="cards-grid">
      ${children}
    </div>
  </div>
</section>`;
}

/** 内容树渲染：根目录直接铺开，子分组才套壳 */
function renderTree(tree) {
  return [
    ...tree.items.map(renderCard),
    ...tree.sections.map(section => renderSection(section, 0)),
  ].join('\n');
}

/** 统计树里的条目数量 */
function countItems(node, predicate) {
  let n = 0;
  for (const item of node.items) if (predicate(item)) n++;
  for (const section of node.sections) n += countItems(section, predicate);
  return n;
}

// ---------- 主逻辑 ----------

if (!fs.existsSync(pagesDir)) {
  console.error(`错误：找不到目录 "${pagesDir}"，请确认它已被提交到仓库。`);
  process.exit(1);
}

// 约定 pages/index.html 是导航页的源模板，不参与扫描
const pagesTemplate = path.join(pagesDir, 'index.html');
const hasPagesTemplate = fs.existsSync(pagesTemplate);
if (hasPagesTemplate) console.log(`提示：${pagesDir}/index.html 被视为模板文件，不参与扫描。`);

let binCounter = 0;
const tree = scan(pagesDir, pagesDir, '未分组');

// 给分组分配稳定的锚点 id 并生成侧栏索引
const sideIndex = [];
(function walk(sections, depth) {
  for (const section of sections) {
    section.id = `nav-${++binCounter}`;
    sideIndex.push({ id: section.id, name: section.name, icon: section.icon, depth, count: section.count });
    walk(section.sections, depth + 1);
  }
})(tree.sections, 0);

const content = renderTree(tree);
const totalProjects = countItems(tree, a => a.kind === 'project');
const totalPages = countItems(tree, () => true);

const sideNav = [
  `<a class="side-link" href="#top" data-target="top" data-depth="0"><i class="fas fa-house"></i><span>首页</span></a>`,
]
  .concat(
    sideIndex.map(
      s =>
        `<a class="side-link" href="#${s.id}" data-target="${s.id}" data-depth="${s.depth}"><i class="fas ${s.icon}"></i><span>${escapeHtml(
          s.name
        )}</span><em>${s.count}</em></a>`
    )
  )
  .join('\n');

const railNav = [
  `<a class="chip" href="#top" data-target="top"><i class="fas fa-house"></i><span>首页</span></a>`,
]
  .concat(
    sideIndex.map(
      s =>
        `<a class="chip" href="#${s.id}" data-target="${s.id}"><i class="fas ${s.icon}"></i><span>${escapeHtml(
          s.name
        )}</span><em>${s.count}</em></a>`
    )
  )
  .join('\n');

let template = fs.readFileSync(templatePath, 'utf8');
template = template
  .replace(/\{\{siteTitle\}\}/g, escapeHtml(site.siteTitle))
  .replace(/\{\{owner\}\}/g, encodeURIComponent(site.owner))
  .replace(/\{\{ownerText\}\}/g, escapeHtml(site.owner))
  .replace(/\{\{bio\}\}/g, escapeHtml(site.bio))
  .replace(/\{\{sideNav\}\}/g, sideNav)
  .replace(/\{\{railNav\}\}/g, railNav)
  .replace(/\{\{content\}\}/g, content)
  .replace(/\{\{generatedAt\}\}/g, new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC')
  .replace(/\{\{statProjects\}\}/g, String(totalProjects))
  .replace(/\{\{statPages\}\}/g, String(totalPages))
  .replace(/\{\{statGroups\}\}/g, String(sideIndex.length));

if (/\{\{\w+\}\}/.test(template)) {
  const left = template.match(/\{\{\w+\}\}/g);
  console.warn(`警告：模板里还有未替换的占位符：${[...new Set(left)].join(', ')}`);
}

fs.writeFileSync(outputFile, template, 'utf8');

console.log(
  `导航页已生成：${totalProjects} 个项目，${totalPages} 个页面，${sideIndex.length} 个分组 → ${outputFile}`
);
