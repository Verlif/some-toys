const fs = require('fs');
const path = require('path');

const pagesDir = 'pages';
const templatePath = 'templates/nav-template.html';
const outputFile = 'index.html';

// 简单转义，防止标题里的特殊字符破坏 HTML
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 读取 pages 文件夹下所有 html
const files = fs.readdirSync(pagesDir).filter(file => file.endsWith('.html'));

const links = files.map(file => {
  const fullPath = path.join(pagesDir, file);
  const content = fs.readFileSync(fullPath, 'utf8');

  // 尝试读取每个页面的 <title>
  const titleMatch = content.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : file.replace('.html', '');
  const fileName = file.replace('.html', '');

  return `
    <li>
      <a href="${pagesDir}/${file}">
        <span class="nav-title">${escapeHtml(title)}</span>
        <span class="nav-file">${escapeHtml(fileName)}</span>
      </a>
    </li>
  `;
}).join('\n');

let template = fs.readFileSync(templatePath, 'utf8');
template = template.replace('{{links}}', links);

fs.writeFileSync(outputFile, template);
console.log('导航页 index.html 已生成');