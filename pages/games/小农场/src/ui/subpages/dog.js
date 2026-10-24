/**
 * 狗窝：查看守护犬品种、安排上岗、往狗粮槽里添粮、升级狗窝。
 *
 * 四层信息，从上到下：
 *   1. **狗粮槽**：整个狗窝共用的存货。槽里没粮，谁上岗都不看家。
 *      存量是**点数**（不是百分比）：喂一份普通粮 +45、精品粮 +100，
 *      上限随狗窝等级长（100 + 30×级）。
 *   2. **狗窝升级**：花金币把槽做大，最高 5 级（+30/级）。
 *   3. **我的狗窝**：所有已收集的品种，同一时刻只能有一只上岗。
 *   4. **图鉴**：十个品种的收集进度，没拿到的显示成灰色。
 *
 * 上岗的品种决定基础拦截率，槽的存量决定它现在有没有力气 ——
 * 两者相乘才是实际拦截概率。品种品阶还决定每日挖宝能带上
 * 哪一档藏宝图（品阶 1-2→一级图 …… 9-10→五级，见 store/dogs.js）。
 */
import { count } from '../../store/inventory.js';
import {
  activeBreed,
  breedProgress,
  dogSatiety,
  feedDog,
  guardChanceNow,
  guardRemainMs,
  kennelCapacity,
  kennelLevel,
  kennelUpgradeState,
  ownedDogs,
  setActiveBreed,
  upgradeKennel,
} from '../../store/dogs.js';
import { DOG_BREEDS, DOG_DIG_CHANCE, DOG_FOOD_PRO_SATIETY, DOG_FOOD_SATIETY } from '../../data/dogs.js';
import { fmtDuration } from '../../core/utils.js';

/**
 * 一只狗的卡片。
 * @param {object} breed 品种
 * @param {boolean} active 是否上岗
 * @param {number} chance 当前实际拦截概率（0~1）
 * @param {boolean} owned 是否已收集
 */
function dogCardHTML(breed, active, chance, owned) {
  if (!owned) {
    return `
      <div class="dog-card locked">
        <div class="dog-emoji">${breed.emoji}</div>
        <div class="dog-name">???</div>
        <div class="dog-rate">基础 ${Math.round(breed.rate * 100)}%</div>
        <div class="dog-hint">冒险里偶遇</div>
      </div>`;
  }

  return `
    <div class="dog-card ${active ? 'active' : ''}">
      <div class="dog-emoji">${breed.emoji}</div>
      <div class="dog-name">${breed.name}</div>
      <div class="dog-rate">基础 ${Math.round(breed.rate * 100)}%</div>
      <div class="dog-hint">${active ? `当前拦截 ${Math.round(chance * 100)}%` : `品阶 ${breed.tier}`}</div>
      <button class="btn small ${active ? 'ghost' : ''}" data-action="dog-active" data-id="${breed.id}">
        ${active ? '休息' : '上岗'}
      </button>
    </div>`;
}

/** 狗粮槽 + 两个喂粮按钮（普通 / 精品） */
function bowlHTML(satiety, cap, offDuty, food, pro) {
  const pct = Math.round((satiety / cap) * 100);
  return `
    <div class="shop-item">
      <div class="si-emoji">${offDuty ? '🛏️' : '🐕'}</div>
      <div class="si-body">
        <div class="si-name">狗粮槽
          <span class="dog-state ${satiety > 0 && !offDuty ? 'on' : 'off'}">
            · ${offDuty ? '无狗上岗' : satiety > 0 ? '守护中' : '槽里没粮'}
          </span>
        </div>
        <div class="dog-bar"><i style="width:${pct}%"></i></div>
        <div class="si-meta">
          存量 <b>${Math.round(satiety)}</b> / ${cap}
          ${offDuty
            ? '· 全部休息，槽不消耗'
            : satiety > 0
              ? `· 还能守 ${fmtDuration(guardRemainMs())}`
              : '· 喂点粮才有人看家'}
        </div>
      </div>
      <div class="dog-feed">
        <button class="btn small ghost" data-action="feed-dog">🦴 添粮${food ? ` (${food})` : ''}</button>
        <button class="btn small ghost" data-action="feed-pro">🍖 精品${pro ? ` (${pro})` : ''}</button>
      </div>
    </div>`;
}

/** 狗窝升级卡：等级、容量、下一级费用 */
function kennelHTML(st, level, cap) {
  const row = st.maxed
    ? `<div class="si-meta">已是最高等级 · 容量封顶 ${cap}</div>`
    : `<div class="si-meta">每升一级容量 +30 · 下一级 <b>Lv.${st.next}</b>（容量 ${cap + 30}）· <b>${st.cost}</b> 💰</div>`;
  return `
    <div class="shop-item">
      <div class="si-emoji">🏠</div>
      <div class="si-body">
        <div class="si-name">狗窝 Lv.${level}
          <span class="dog-state ${level > 0 ? 'on' : 'off'}">· 槽容量 ${cap}</span>
        </div>
        ${row}
      </div>
      ${st.maxed ? '' : `<button class="btn small" data-action="kennel-upgrade" ${st.ok ? '' : 'disabled'}>升级</button>`}
    </div>`;
}

export const dogPage = {
  render(body) {
    const satiety = dogSatiety();
    const cap = kennelCapacity();
    const active = activeBreed();
    const food = count('dogFood');
    const pro = count('dogFoodPro');
    const chance = guardChanceNow();
    const owned = ownedDogs();
    const ownedIds = new Set(owned.map((b) => b.id));
    const progress = breedProgress();
    const kennel = kennelUpgradeState();

    // 全部休息：槽里的粮不会消耗，但农场也完全不设防
    const offDuty = !active;

    body.innerHTML = `
      <div class="section-title">🦴 狗粮槽（共用）</div>
      <div class="list">
        ${bowlHTML(satiety, cap, offDuty, food, pro)}
        ${kennelHTML(kennel, kennelLevel(), cap)}
      </div>

      <div class="section-title">🐕 我的狗窝（${progress.owned} / ${progress.total}）</div>
      <div class="dog-grid">
        ${DOG_BREEDS.map((b) => dogCardHTML(
          b,
          active?.id === b.id,
          chance,
          ownedIds.has(b.id),
        )).join('')}
      </div>

      <div class="dog-facts">
        <div>· 同一时刻只有一只狗上岗，上岗的那只决定基础拦截率</div>
        <div>· 狗粮槽是<b>全窝共用</b>的一份存货：普通粮 +${DOG_FOOD_SATIETY}、精品粮 +${DOG_FOOD_PRO_SATIETY}，每小时 −6.25</div>
        <div>· 升级狗窝可以扩容（每级 +30，最高 Lv.5 · 容量 250）</div>
        <div>· 有狗上岗且槽里有粮时，守护犬每天有 <b>${Math.round(DOG_DIG_CHANCE * 100)}%</b> 概率挖到一份藏宝图奖励（按品种品阶对应图档）</div>
        <div>· 全部休息时槽不消耗，但农场也完全不设防</div>
        <div>· 十个品种只能从<b>冒险</b>里获得（低概率，按藏宝图档位分品阶，不重复）</div>
        ${active ? `<div>· 当前：${active.emoji} <b>${active.name}</b>，实际拦截率 <b>${Math.round(chance * 100)}%</b></div>` : ''}
      </div>
    `;
  },

  actions: {
    'feed-dog': () => feedDog('dogFood'),
    'feed-pro': () => feedDog('dogFoodPro'),
    'kennel-upgrade': () => upgradeKennel(),
    async 'dog-active'(el) {
      const id = el.dataset.id;
      // 点已上岗的那只 = 让它休息，农场暂时不设防
      await setActiveBreed(activeBreed()?.id === id ? null : id);
    },
  },
};
