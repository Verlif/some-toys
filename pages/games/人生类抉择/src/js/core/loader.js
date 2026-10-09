/**
 * 剧本加载器
 *
 * 启动时按 data/manifest.json 的清单，把 init/ 与 choices/ 下的 JSON 全部读入，
 * 合并后交给 registry.install()。新增剧本文件只需要在 manifest 里登记一行。
 *
 * 之所以用 manifest 而不是遍历目录：浏览器没有列目录的能力。
 */

import { db, install } from './registry.js';

/** 默认取「项目根/data/」——相对本模块上溯三级（core → js → src → 根） */
const DEFAULT_BASE = new URL('../../../data/', import.meta.url).href;

/** 浏览器默认读取实现 */
async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} · ${url}`);
  return res.json();
}

/**
 * 加载全部剧本数据
 * @param {object} [opts]
 * @param {string} [opts.base]  数据根目录，默认 ../../../data/
 * @param {(url:string)=>Promise<any>} [opts.read] 自定义读取实现（Node 自检脚本用 fs）
 * @returns {Promise<{events:number, traits:number, aspirations:number, files:number}>}
 */
export async function loadAll(opts = {}) {
  const base = opts.base || DEFAULT_BASE;
  const read = opts.read || fetchJSON;
  const get = async rel => {
    try {
      return await read(base + rel);
    } catch (err) {
      throw new Error(`读取剧本失败 [${rel}]：${err.message}`);
    }
  };

  const manifest = await get('manifest.json');
  if (!manifest || !Array.isArray(manifest.init) || !Array.isArray(manifest.choices)) {
    throw new Error('manifest.json 格式不正确：需要 init 与 choices 两个数组');
  }

  const [initParts, choiceParts] = await Promise.all([
    Promise.all(manifest.init.map(get)),
    Promise.all(manifest.choices.map(get))
  ]);

  /* ---- 合并 init/ ---- */
  const merged = {
    meters: [], stages: [], skills: [], relations: [],
    traits: {}, aspirations: {}, endings: {},
    config: {}
  };

  for (const part of initParts) {
    if (Array.isArray(part.meters)) merged.meters.push(...part.meters);
    if (Array.isArray(part.stages)) merged.stages.push(...part.stages);
    if (Array.isArray(part.skills)) merged.skills.push(...part.skills);
    if (Array.isArray(part.relations)) merged.relations.push(...part.relations);
    if (part.traits) Object.assign(merged.traits, part.traits);
    if (part.aspirations) Object.assign(merged.aspirations, part.aspirations);
    if (part.endings) Object.assign(merged.endings, part.endings);

    if (part.initial || part.flags || part.tuning || part.grades || part.flagLabels) {
      merged.config = {
        ...merged.config,
        initial: part.initial || merged.config.initial,
        flags: part.flags || merged.config.flags,
        tuning: part.tuning || merged.config.tuning,
        grades: part.grades || merged.config.grades,
        flagLabels: part.flagLabels || merged.config.flagLabels
      };
    }
  }

  /* ---- 合并 choices/ ---- */
  const events = [];
  manifest.choices.forEach((rel, i) => {
    const part = choiceParts[i];
    const list = Array.isArray(part) ? part : (part.events || []);
    for (const e of list) events.push({ ...e, _src: rel });
  });

  install({ ...merged, events });

  return {
    events: db.events.length,
    traits: db.traitIds.length,
    aspirations: db.aspirationIds.length,
    files: manifest.init.length + manifest.choices.length + 1
  };
}
