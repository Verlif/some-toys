/**
 * 子页面注册表。新增一个子页面 = 新建一个模块 + 在这里登记。
 */
import { bagPage } from './bag.js';
import { packagePage } from './package.js';
import { codexPage } from './codex.js';
import { signPage } from './sign.js';
import { guidePage } from './guide.js';
import { dogPage } from './dog.js';
import { placeholderPage } from './placeholder.js';

/** @type {Record<string, {render: (body: HTMLElement, ctx: any) => void, actions?: Record<string, Function>}>} */
export const subpages = {
  bag: bagPage,
  package: packagePage,
  codex: codexPage,
  sign: signPage,
  guide: guidePage,
  dog: dogPage,
  ranch: placeholderPage,
  workshop: placeholderPage,
  market: placeholderPage,
  settings: placeholderPage,
};