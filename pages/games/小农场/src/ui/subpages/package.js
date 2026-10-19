/**
 * 包裹：查看已拥有的种子与道具（只读陈列）。
 */
import { CROPS, CROP_IDS } from '../../data/crops.js';
import { ITEMS, ITEM_IDS } from '../../data/items.js';
import { seedId } from '../../data/keys.js';
import { count } from '../../store/inventory.js';
import { fmtDuration } from '../../core/utils.js';

function section(title, rows) {
  return rows ? `<div class="section-title">${title}</div><div class="list">${rows}</div>` : '';
}

export const packagePage = {
  render(body) {
    const seeds = CROP_IDS.filter((id) => count(seedId(id)) > 0);
    const items = ITEM_IDS.filter((id) => count(id) > 0);

    const seedRows = seeds.map((id) => {
      const crop = CROPS[id];
      return `
        <div class="shop-item">
          <div class="si-emoji">${crop.emoji}</div>
          <div class="si-body">
            <div class="si-name">${crop.name}种子 <span style="color:#8a978a;font-weight:400;font-size:11.5px">×${count(seedId(id))}</span></div>
            <div class="si-meta">${fmtDuration(crop.grow * 1000)}成熟 · 需 Lv.${crop.lv}</div>
          </div>
        </div>`;
    }).join('');

    const itemRows = items.map((id) => {
      const item = ITEMS[id];
      return `
        <div class="shop-item">
          <div class="si-emoji">${item.emoji}</div>
          <div class="si-body">
            <div class="si-name">${item.name} <span style="color:#8a978a;font-weight:400;font-size:11.5px">×${count(id)}</span></div>
            <div class="si-meta">${item.desc}</div>
          </div>
        </div>`;
    }).join('');

    const html = section('🌱 种子', seedRows) + section('🧪 道具', itemRows);
    body.innerHTML = html
      || '<div class="empty-tip">🎒<br>包裹空空如也<br>去商店采购种子和道具吧～</div>';
  },
};