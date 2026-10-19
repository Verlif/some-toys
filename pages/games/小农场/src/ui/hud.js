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
import {
  expForLevel,
  MAX_LEVEL,
  PLOT_UNLOCK_LV,
  TITLES,
  TOTAL_PLOTS,
  titleOf,
  unlockedPlotCount,
} from '../data/progression.js';
import { codexSummary } from '../store/codex.js';
import { currentStreak } from '../store/signin.js';

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
    dTitle: byId('dTitle'),
    dNextTitle: byId('dNextTitle'),
    dExp: byId('dExp'),
    dPlots: byId('dPlots'),
    dStreak: byId('dStreak'),
    dCodex: byId('dCodex'),
  };
}

/** 下一个称号及其所需等级 */
function nextTitle(level) {
  const next = TITLES.find(([minLv]) => minLv > level);
  return next ? `Lv.${next[0]} ${next[1]}` : '已达最高称号';
}

/** 重绘 HUD */
export function renderHud() {
  if (!els) collect();
  if (!els?.name) return;

  const { level, exp, coins, name } = state.player;
  const maxed = level >= MAX_LEVEL;

  els.name.innerHTML = escapeHtml(name);
  els.name.title = name;
  els.level.textContent = level;
  els.title.textContent = titleOf(level);
  els.coins.textContent = coins;

  els.dTitle.textContent = titleOf(level);
  els.dNextTitle.textContent = nextTitle(level);
  els.dExp.textContent = maxed ? '已满级' : `${exp} / ${expForLevel(level)}`;
  els.dPlots.textContent = `${unlockedPlotCount(level)} / ${TOTAL_PLOTS}`;
  els.dStreak.textContent = `${currentStreak()} 天`;
  const codex = codexSummary();
  els.dCodex.textContent = `${codex.lit} / ${codex.total}（${codex.percent}%）`;
}

/** 下一块待解锁土地要多少级，用于「下一块地」提示 */
export function nextPlotLevel(level) {
  return PLOT_UNLOCK_LV.find((need) => need > level);
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