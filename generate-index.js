const fs = require('fs');
const path = require('path');

const pagesDir = 'pages';
const templatePath = 'templates/nav-template.html';
const outputFile = 'index.html';

// 图标映射：分组名或文件名包含关键词时使用对应图标
const iconMap = {
  default: 'fa-file-code',
  game: 'fa-gamepad',
  '小游戏': 'fa-gamepad',
  tool: 'fa-wrench',
  '工具': 'fa-wrench',
  demo: 'fa-flask',
  blog: 'fa-pen-fancy',
  ai: 'fa-robot',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pickIcon(name) {
  const lower = name.toLowerCase();
  const key = Object.keys(iconMap).find(k => lower.includes(k.toLowerCase()));
  return iconMap[key] || iconMap.default;
}

/**
 * 读取单个 HTML 文件并生成卡片 HTML
 * @param {string} filePath 磁盘路径
 * @param {string} fileName 文件名，如 snake.html
 * @param {string} urlPath  相对 index.html 的 URL 路径，如 pages/小游戏/snake.html
 */
function buildCard(filePath, fileName, urlPath) {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.warn(`无法读取 ${filePath}: ${e.message}`);
  }

  const titleMatch = content.match(/<title>(.*?)<\/title>/i);
  const rawTitle = titleMatch ? titleMatch[1].trim() : fileName.replace('.html', '');
  const descMatch = content.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);
  const desc = descMatch ? descMatch[1].trim() : '';
  const icon = pickIcon(fileName);

  return `
    <a href="${urlPath}" class="card" target="_blank" rel="noopener">
      <i class="fas ${icon} card-icon"></i>
      <span class="card-title">${escapeHtml(rawTitle)}</span>
      ${desc ? `<span class="card-desc">${escapeHtml(desc)}</span>` : ''}
    </a>
  `;
}

// ---------- 主逻辑 ----------

if (!fs.existsSync(pagesDir)) {
  console.error(`错误：找不到目录 "${pagesDir}"，请确认它已被提交到仓库。`);
  process.exit(1);
}

const entries = fs.readdirSync(pagesDir, { withFileTypes: true });

// 第一层：根目录下的 html 文件
const rootFiles = entries
  .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.html'))
  .map(e => e.name)
  .sort();

// 第二层：一级子文件夹
const subDirs = entries
  .filter(e => e.isDirectory() && !e.name.startsWith('.'))
  .map(e => e.name)
  .sort();

// 生成根目录卡片
const rootCardsHtml = rootFiles
  .map(name => buildCard(
    path.join(pagesDir, name),
    name,
    `${pagesDir}/${name}`
  ))
  .join('\n');

// 生成分组
const groupsHtml = subDirs.map(dirName => {
  const dirPath = path.join(pagesDir, dirName);
  const files = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.html'))
    .map(e => e.name)
    .sort();

  if (files.length === 0) {
    console.warn(`跳过空分组：${dirName}`);
    return '';
  }

  const groupIcon = pickIcon(dirName);
  const cards = files
    .map(name => buildCard(
      path.join(dirPath, name),
      name,
      `${pagesDir}/${dirName}/${name}`
    ))
    .join('\n');

  return `
    <section class="group">
      <h2 class="group-title">
        <i class="fas ${groupIcon}"></i>
        <span>${escapeHtml(dirName)}</span>
        <span class="group-count">${files.length}</span>
      </h2>
      <div class="cards-grid">
        ${cards}
      </div>
    </section>
  `;
}).filter(Boolean).join('\n');

// 组装内容
const contentParts = [];
if (rootCardsHtml) {
  contentParts.push(`
    <section class="group group-root">
      <div class="cards-grid">
        ${rootCardsHtml}
      </div>
    </section>
  `);
}
if (groupsHtml) {
  contentParts.push(groupsHtml);
}

const content = contentParts.join('\n');

let template = fs.readFileSync(templatePath, 'utf8');
template = template.replace('{{content}}', content);

fs.writeFileSync(outputFile, template);

const total = rootFiles.length + subDirs.length;
console.log(`导航页已生成：${rootFiles.length} 个根页面，${subDirs.length} 个分组。`);