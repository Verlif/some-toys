/**
 * 作物图鉴：全量作物展示 + 标本制作 + 详情弹窗。
 *
 * 卡片上只留「图标 + 名称」—— 图鉴本来就是一面墙：一眼扫过去看收集了多少，
 * 想算收益、看产量、做标本就点开。成熟时间、单价、个人统计这些
 * 全部在点开后的作物弹窗里（全游戏共用一个 `ui/crop-detail.js`）。
 *
 * 四种状态：
 *   lit         已点亮   做过标本 → 彩色图标 + 名字
 *   collected   已收集   拿到过产出、还没做标本 → **灰图标**（去色但不打码）+ 名字
 *   unlocked    未收集   等级够、还没拿到过产出 → 剪影 ❔ + 「未收集」，**可以点开看数据**
 *   locked      未解锁   等级不够且没见过 → 剪影 ❔ + 「???」，不给点（看了也用不上）
 *
 * 灰与 ❔ 的区别就是「见过没」：灰图标认得出来是哪种作物，只是还没点亮；
 * ❔ 是连见都没见过。一眼扫过去，彩色 = 点亮，灰 = 收集，问号 = 空。
 *
 * 「收集」与「点亮」分开：收集 = 见过（偷来的、邻居送的都算），
 * 点亮 = 做了一份标本（花掉 50 个产出），后者才是成就，见详情弹窗与称号。
 *
 * ⚠️ 点得开的条件是「等级够 **或** 见过」—— 邻居送礼、偷菜都不看等级，
 * 低级玩家手里完全可能躺着高级作物的产出，这种灰卡必须能点开做标本。
 */
import { CROPS } from '../../data/crops.js';
import { MAP_TIERS } from '../../data/adventure.js';
import { CODEX_SEED_REWARD, SPECIMEN_COST, codexEntries, codexSummary, makeSpecimen } from '../../store/codex.js';
import { closeModal } from '../modal.js';
import { openCropModal } from '../crop-detail.js';

/**
 * 筛选档。
 *
 * 「可点亮」是玩家真正需要的那个：仓库里攒够了 50 个、就差一下制作。
 * 「已收集」看的是见过多少种 —— 产出进过仓库就算，不看有没有做标本。
 */
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'canMake', label: '可点亮' },
  { key: 'collected', label: '已收集' },
];

let mode = 'all';

/** 这种作物能从哪几档藏宝图里挖到（按种子上限算） */
function mapSources(crop) {
  if (!crop.special) return '';
  const tiers = MAP_TIERS.filter((m) => m.seedCap >= crop.lv);
  if (!tiers.length) return '';
  return tiers.map((m) => `${m.emoji} ${m.name.replace('藏宝图', '')}`).join(' / ');
}

/**
 * 这种作物从哪来（图鉴卡片底部的一行小字）。
 *
 * 第 52 轮加了村庄荣耀种子：它们也是 special（商店不卖），
 * 但来源是「村子升到第 N 级时全村发放」，不是藏宝图 —— 说错了玩家会去白挖图。
 */
function sourceText(crop) {
  if (crop.honor) return `🏅 村庄升到 Lv.${crop.honor} 时全村发放`;
  if (!crop.special) return '';
  const maps = mapSources(crop);
  return `🧭 藏宝图限定 · ${maps || '暂无可挖档位'}`;
}

/**
 * 一张图鉴卡片：只有图标与名字。
 * @param {object} entry codexEntries() 的一项
 */
function cardHTML(entry) {
  const shadow = !entry.collected;         // 没见过：剪影 + 问号
  const dull = entry.collected && !entry.lit;   // 见过但没做标本：灰图标
  const locked = !entry.unlocked;

  // 动作属性必须写在 class 之外，塞进 class 里会把 HTML 解析坏
  // 收集过的灰卡也点得开：等级不够照样可能收到邻居送的产出
  const clickable = entry.unlocked || entry.collected;
  const attrs = clickable
    ? ` data-action="codex-detail" data-id="${entry.id}" role="button" tabindex="0"`
    : '';
  const label = shadow ? (locked ? '???' : '未收集') : entry.name;
  const cls = ['codex-card', shadow && 'shadow', dull && 'dull', locked && 'locked', clickable && 'clickable']
    .filter(Boolean).join(' ');

  return `
    <div class="${cls}"${attrs}>
      <div class="codex-emoji">${shadow ? '❔' : entry.emoji}</div>
      <div class="codex-name">${label}</div>
    </div>`;
}

/**
 * 作物详情弹窗。
 *
 * 卡片本身用的是全游戏唯一的作物弹窗（`ui/crop-detail.js`），
 * 这里只补三块图鉴专属的内容：来源说明、我的统计、制作标本按钮。
 * @param {string} cropId
 */
function openDetailModal(cropId) {
  const crop = CROPS[cropId];
  if (!crop) return;
  const entry = codexEntries().find((e) => e.id === cropId);
  const stat = { planted: entry?.planted || 0, harvested: entry?.harvested || 0, owned: entry?.owned || 0 };
  const mark = !entry?.collected
    ? '未收集'
    : entry.specimen ? '已收集 · 已点亮' : '已收集 · 未点亮';
  const markHint = entry?.collected && !entry.specimen ? '　做一份标本就点亮' : '';

  // 来源：商店买 vs 藏宝图挖 vs 村庄荣耀发放
  const source = crop.honor
    ? `🏅 村庄荣耀 · 升到 Lv.${crop.honor} 时全村发放`
    : crop.special
      ? `🧭 藏宝图限定 · ${mapSources(crop) || '暂无可挖档位'}`
      : `🛒 商店购买 · 种子 💰 ${crop.seed}`;

  // 已经点亮过就不再给「制作标本」的入口：再做一份没有奖励，
  // 还会白白吃掉 50 份产出（第 45 轮玩家反馈）
  const actions = !entry?.specimen && stat.owned >= SPECIMEN_COST
    ? `<div class="modal-foot">
        <div class="sd-buybar">
          <button class="btn sd-buy" data-action="specimen-make" data-id="${cropId}">
            🧪 制作标本（花掉 ${SPECIMEN_COST} 个${crop.name}）· 点亮奖 ${CODEX_SEED_REWARD} 颗种子
          </button>
        </div>
      </div>`
    : '';

  openCropModal(cropId, {
    extra: `<div class="sd-gain">📖 图鉴　<b>${mark}</b>${markHint}</div>
      <div class="sd-gain">
      我的统计　种植 <b>${stat.planted}</b> 次 · 收获 <b>${stat.harvested}</b> 个
      ${stat.planted || stat.harvested ? '' : '（还没有种过）'}
    </div>`,
    foot: source,
    actions,
    onAction: async (action, el) => {
      if (action !== 'specimen-make') return;
      const cropId = el.dataset.id;
      // 先关弹窗再播庆祝：庆祝层盖在整屏上，弹窗留在后面会显得「没关掉」。
      // 万一制作失败（仓库刚够又被别处扣掉），把详情弹回来，别让玩家对着空屏发呆。
      closeModal();
      if (!(await makeSpecimen(cropId))) openDetailModal(cropId);
    },
  });
}

export const codexPage = {
  render(body) {
    const entries = codexEntries();
    const summary = codexSummary();
    const counts = {
      all: entries.length,
      canMake: entries.filter((e) => e.canMake).length,
      collected: summary.collected,
    };
    const shown = mode === 'all' ? entries : entries.filter((e) => e[mode]);

    const chips = FILTERS.map((f) => `
      <button class="filter-chip ${f.key === mode ? 'active' : ''}"
              data-action="codex-filter" data-id="${f.key}">${f.label}<i class="chip-num">${counts[f.key]}</i></button>`)
      .join('');

    body.innerHTML = `
      <div class="codex-head">
        <div class="codex-head-row">
          <div>
            <div class="codex-head-title">已收集 ${summary.collected} / ${summary.total}</div>
            <div class="codex-head-sub">已点亮 ${summary.lit} 种 · 已解锁 ${summary.unlocked} 种 · 收集 ${summary.percent}% · 点亮 ${summary.litPercent}%</div>
          </div>
        </div>
        <div class="codex-bar" role="img"
             aria-label="收集进度 ${summary.percent}%，点亮进度 ${summary.litPercent}%">
          <i class="bar-lit" style="width:${summary.litPercent}%"></i>
          <i class="bar-collected" style="width:${summary.percent}%"></i>
        </div>
        <div class="codex-filters">${chips}</div>
        <div class="codex-tip">金色 = 已点亮 · 绿色 = 已收集 · 彩色卡片 = 已点亮 · 灰色 = 已收集未点亮 · ❔ = 没见过　｜　做一份标本（${SPECIMEN_COST} 个）点亮 · 奖 ${CODEX_SEED_REWARD} 颗种子</div>
      </div>
      ${shown.length
        ? `<div class="codex-grid">${shown.map(cardHTML).join('')}</div>`
        : emptyHTML()}`;
  },

  actions: {
    'codex-filter'(el) {
      mode = el.dataset.id;
    },
    'codex-detail'(el) {
      openDetailModal(el.dataset.id);
    },
  },
};

/** 空列表提示：区分「一种都没收集」和「这个筛选下没有」 */
function emptyHTML() {
  if (mode === 'canMake') {
    return `<div class="empty-tip">🧪<br>现在没有攒够 ${SPECIMEN_COST} 个的作物<br>先去收获一轮再来</div>`;
  }
  return '<div class="empty-tip">📖<br>还没有收集到任何作物<br>去农场收获第一份吧～</div>';
}
