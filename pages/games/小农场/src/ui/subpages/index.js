/**
 * 子页面注册表。新增一个子页面 = 新建一个模块 + 在这里登记。
 */
import { bagPage } from './bag.js';
import { packagePage } from './package.js';
import { codexPage } from './codex.js';
import { titlesPage } from './titles.js';
import { signPage } from './sign.js';
import { guidePage } from './guide.js';
import { dogPage } from './dog.js';
import { workshopPage } from './workshop.js';
import { manualPage } from './manual.js';
import { ordersPage } from './orders.js';
import { settingsPage } from './settings.js';

// 排行榜不在子页面里：它从村中心以**弹窗**打开（见 subpages/rank.js 的 openRankModal）

/** @type {Record<string, {render: (body: HTMLElement, ctx: any) => void, actions?: Record<string, Function>}>} */
export const subpages = {
  bag: bagPage,
  package: packagePage,
  codex: codexPage,
  titles: titlesPage,
  sign: signPage,
  guide: guidePage,
  dog: dogPage,
  seedshop: workshopPage,
  manual: manualPage,
  orders: ordersPage,
  settings: settingsPage,
};