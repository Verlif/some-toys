/**
 * 顶部 HUD。
 *
 * 收起时只展示「名字 / 等级 / 称号 / 金币」四样基础信息；
 * 点一下展开详细信息面板。展开层是 absolute 定位并盖在内容之上，
 * 所以**不会把下面的土地区域挤走**，也不会改变页面高度。
 */
import { byId, escapeHtml } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { state } from '../store/state.js';
import { expForLevel, MAX_LEVEL, TOTAL_PLOTS } from '../data/progression.js';
import { unlockedPlotCount } from '../store/farm.js';
import { SOILS } from '../data/soils.js';
import { codexSummary } from '../store/codex.js';
import { currentStreak } from '../store/signin.js';
import { equippedTitle, titleStates } from '../store/titles.js';

let els = null;

function collect() {
  els = {
    bar: byId('hudToggle'),
    hud: byId('hudToggle')?.closest('.hud'),
    detail: byId('hudDetail'),
    name: byId('nameText'),
    level: byId('lvText'),
    title: byId('titleText'),
    coins: byId('coinText'),
    dLevel: byId('dLevel'),
    dTitle: byId('dTitle'),
    dNextTitle: byId('dNextTitle'),
    dExp: byId('dExp'),
    dExpBar: byId('dExpBar'),
    dPlots: byId('dPlots'),
    dStreak: byId('dStreak'),
    dCodex: byId('dCodex'),
    dSoil: byId('dSoil'),
  };
}

/**
 * 下一个还没领到的称号 —— 用来提示「有新的可以领了」。
 * 等级称号与图鉴称号混在一起按达成度排，先看哪个更接近。
 */
function nextTitle() {
  const pending = titleStates().filter((t) => !t.claimed);
  if (!pending.length) return '全部称号已领完';
  const next = pending.reduce((best, t) => (
    t.need.type === 'level'
      ? (best.need.type === 'codex' || t.need.value - state.farm.level < best.need.value - state.farm.level ? t : best)
      : best
  ), pending[0]);
  return next.need.type === 'level'
    ? `Lv.${next.need.value} ${next.name}`
    : `点亮 ${next.need.value} 种 ${next.name}`;
}

/** 佩戴的称号（没佩戴过时为 null） */
function titleText() {
  const t = equippedTitle();
  return t ? `${t.emoji} ${t.name}` : '未佩戴称号';
}

/** 重绘 HUD */
export function renderHud() {
  if (!els) collect();
  if (!els?.name) return;

  const { level, exp, coins, name } = state.farm;
  const maxed = level >= MAX_LEVEL;

  els.name.innerHTML = escapeHtml(name);
  els.name.title = name;
  els.level.textContent = level;
  els.title.textContent = titleText();
  els.coins.textContent = coins;

  els.dLevel.textContent = level;
  els.dTitle.textContent = titleText();

  const need = expForLevel(level);
  els.dExp.textContent = maxed ? '已满级' : `${exp} / ${need}`;
  const percent = maxed ? 100 : Math.max(0, Math.min(100, (exp / need) * 100));
  els.dExpBar.style.width = `${percent}%`;

  els.dNextTitle.textContent = nextTitle();
  els.dPlots.textContent = `${unlockedPlotCount()} / ${TOTAL_PLOTS}`;
  const soil = soilStats();
  els.dSoil.textContent = soilText(soil);
  els.dSoil.title = soilTitle(soil);
  els.dStreak.textContent = `${currentStreak()} 天`;
  const codex = codexSummary();
  els.dCodex.textContent = `${codex.collected} / ${codex.total}（${codex.percent}%）`;
}

/**
 * 已解锁地块按土地档位分类。
 * @returns {{counts: Record<string, number>, unlocked: number, avgMul: number}}
 */
function soilStats() {
  const unlocked = unlockedPlotCount();
  const counts = {};
  let mulSum = 0;
  for (const plot of state.farm.plots) {
    if (!plot.usable) continue;
    const soil = SOILS[plot.soil] || SOILS.normal;
    counts[plot.soil || 'normal'] = (counts[plot.soil || 'normal'] || 0) + 1;
    mulSum += soil.yieldMul;
  }
  return { counts, unlocked, avgMul: unlocked ? mulSum / unlocked : 1 };
}

/**
 * 土地构成的一句话摘要。
 *
 * 全是普通地就只写数量；有升级过的就按档次从高到低列，
 * 最多列 3 档，再多就折成「等 N 档」—— 顶栏这一格放不下长句子。
 */
function soilText({ counts, unlocked }) {
  const upgraded = Object.keys(SOILS).filter((id) => id !== 'normal' && counts[id]);
  if (!upgraded.length) return `普通 ×${unlocked}`;
  const ordered = upgraded.reverse();
  const parts = ordered.slice(0, 3).map((id) => `${SOILS[id].tag} ×${counts[id]}`);
  return parts.join(' · ') + (ordered.length > 3 ? ` 等 ${ordered.length} 档` : '');
}

/** 悬停时给出完整明细与平均产量倍率 */
function soilTitle({ counts, avgMul }) {
  const rows = Object.keys(SOILS)
    .filter((id) => counts[id])
    .map((id) => `${SOILS[id].name} ×${counts[id]}（产量 ×${SOILS[id].yieldMul.toFixed(2)}）`);
  const bonus = Math.round((avgMul - 1) * 100);
  return `${rows.join('\n')}\n平均产量 ${bonus >= 0 ? '+' : ''}${bonus}%`;
}

/** 展开 / 收起详情面板 */
export function toggleHudDetail(force) {
  if (!els) collect();
  const open = force ?? els.detail.hidden;
  els.detail.hidden = !open;
  els.bar.setAttribute('aria-expanded', String(open));
  els.bar.classList.toggle('open', open);
  // 顶栏本体也要收掉底部圆角，详情面板才能严丝合缝地接上来
  els.hud?.classList.toggle('open', open);
}

/**
 * 把顶栏实际高度写进 CSS 变量，供商店等需要吸附到顶栏下方的组件使用。
 * 顶栏高度会随刘海屏的安全区变化，量出来比写死更可靠。
 */
function syncHudHeight() {
  const bar = byId('hudToggle');
  if (bar) document.documentElement.style.setProperty('--hud-h', `${bar.offsetHeight}px`);
}

/** 订阅玩家状态变化，并绑定展开交互 */
export function mountHud() {
  collect();

  els.bar.addEventListener('click', () => toggleHudDetail());
  // 展开状态下点击别处自动收起。
  // 注意要排除顶栏本身：点击顶栏的事件也会冒泡到 document，
  // 否则「点开 → 立刻被关掉」，展开功能等于没有。
  document.addEventListener('click', (event) => {
    if (els.detail.hidden) return;
    if (els.detail.contains(event.target) || els.bar.contains(event.target)) return;
    toggleHudDetail(false);
  });

  syncHudHeight();
  window.addEventListener('resize', syncHudHeight);
  window.addEventListener('orientationchange', syncHudHeight);

  on(EVENTS.PLAYER, renderHud);
  on(EVENTS.SIGN, renderHud);
  on(EVENTS.CODEX, renderHud);
}