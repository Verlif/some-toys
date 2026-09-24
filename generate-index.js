const fs = require('fs');
const path = require('path');

const pagesDir = 'pages';
const templatePath = 'templates/nav-template.html';
const outputFile = 'index.html';

// 页面显示名映射（可选，优先使用 <title>）
const titleOverrides = {
  // 'page1': '自定义标题',
};

// 图标映射：文件名 → Font Awesome 类名
const iconMap = {
  default: 'fa-file-code',
  game: 'fa-gamepad',
  tool: 'fa-wrench',
  demo: 'fa-flask',
  blog: 'fa-pen-fancy',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

if (!fs.existsSync(pagesDir)) {
  console.error(`错误：找不到目录 "${pagesDir}"，请确认它已被提交到仓库。`);
  process.exit(1);
}

const files = fs.readdirSync(pagesDir)
  .filter(file => file.endsWith('.html'))
  .sort();

if (files.length === 0) {
  console.warn(`警告：${pagesDir} 里没有任何 .html 文件，将生成空导航。`);
}

const links = files.map(file => {
  const fullPath = path.join(pagesDir, file);
  const content = fs.readFileSync(fullPath, 'utf8');

  // 读取标题
  const titleMatch = content.match(/<title>(.*?)<\/title>/i);
  const rawTitle = titleMatch ? titleMatch[1].trim() : file.replace('.html', '');
  const baseName = file.replace('.html', '');
  const title = titleOverrides[baseName] || rawTitle;

  // 读取描述（从 meta description）
  const descMatch = content.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);
  const desc = descMatch ? descMatch[1].trim() : '';

  // 选择图标
  const iconKey = Object.keys(iconMap).find(key =>
    baseName.toLowerCase().includes(key)
  );
  const icon = iconMap[iconKey] || iconMap.default;

  return `
    <a href="${pagesDir}/${file}" class="card" data-title="${escapeHtml(title.toLowerCase())}" data-desc="${escapeHtml(desc.toLowerCase())}">
      <i class="fas ${icon} card-icon"></i>
      <span class="card-title">${escapeHtml(title)}</span>
      ${desc ? `<span class="card-desc">${escapeHtml(desc)}</span>` : ''}
    </a>
  `;
}).join('\n');

let template = fs.readFileSync(templatePath, 'utf8');
template = template.replace('{{links}}', links);

fs.writeFileSync(outputFile, template);
console.log(`导航页 index.html 已生成，共 ${files.length} 个页面。`);