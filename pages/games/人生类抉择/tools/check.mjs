/**
 * 逻辑冒烟自检（无需浏览器）
 * 用法：npm run check
 *
 * 检查四件事：
 *   1. 剧本 JSON 能完整加载（manifest + init/ + choices/）
 *   2. 事件库数据合法性（id 唯一、左右选项完整、年龄区间合理、无外部图片引用）
 *   3. 引擎能否完整跑完一局（不死循环、必定收敛到某个结局）
 *   4. 相同种子下结果可复现
 */
import { readFile } from 'node:fs/promises';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 用 fs 代替 fetch，让浏览器用的 loader 能在 Node 里复用
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const BASE = join(ROOT, 'data') + sep;
const imp = p => import(pathToFileURL(p).href);

const { loadAll, db, tuning, setSeed, newGame, pickEvent, choose, scoreOf, gradeOf } =
  await imp(join(ROOT, 'src/js/core/engine.js'));

let failed = 0;
const ok  = msg => console.log('  ✓ ' + msg);
const bad = msg => { failed++; console.error('  ✗ ' + msg); };

/* ---------- 1. 加载剧本 ---------- */
console.log('\n[1] 剧本加载');
let info = null;
try {
  info = await loadAll({ base: BASE, read });
  ok(`${info.files} 个 JSON 文件加载完成`);
  ok(`${info.events} 条抉择 · ${db.meters.length} 项属性 · ${info.traits} 种特质 · ${info.aspirations} 种心愿`);
} catch (err) {
  bad('剧本加载失败：' + err.message);
  console.error(err);
  process.exit(1);
}

/* ---------- 2. 数据校验 ---------- */
console.log('\n[2] 数据校验');
db.mIds.forEach(id => {
  const m = db.meterMap[id];
  if (!db.endings[id] || !db.endings[id].low || !db.endings[id].high) bad(`属性「${m.label}」缺少结局文案`);
});
if (!db.endings.win) bad('缺少 win 结局');
ok('六项属性的 high/low 结局 + win 结局齐全');

const seen = new Set();
let urlHit = 0;
for (const e of db.events) {
  if (seen.has(e.id)) bad(`事件 id 重复：${e.id}（${e._src}）`);
  seen.add(e.id);
  if (!e.left || !e.left.label) bad(`${e.id} 缺少 left 选项（${e._src}）`);
  if (!e.right || !e.right.label) bad(`${e.id} 缺少 right 选项（${e._src}）`);
  if (!(e.min <= e.max)) bad(`${e.id} 年龄区间非法 ${e.min}~${e.max}（${e._src}）`);
  if (e.min < 6 || e.max > 120) bad(`${e.id} 年龄区间越界 ${e.min}~${e.max}（${e._src}）`);
  if (JSON.stringify(e).match(/https?:\/\//)) { urlHit++; bad(`${e.id} 内含外部链接（${e._src}）`); }
}
if (!urlHit) ok(`${db.events.length} 条事件合法（id 唯一、选项完整、无任何外部资源引用）`);

const condKeys = new Set(['trait', 'flag', 'noFlag', 'skill', 'stat', 'rel', 'age']);
let condErr = 0;
for (const e of db.events) {
  const groups = e.cond ? (Array.isArray(e.cond) ? e.cond : [e.cond]) : [];
  for (const g of groups) {
    for (const k of Object.keys(g)) {
      if (!condKeys.has(k)) { bad(`${e.id} 的 cond 含未知键「${k}」`); condErr++; }
    }
  }
}
for (const id of db.aspirationIds) {
  const check = db.aspirations[id].check;
  if (!Array.isArray(check)) { bad(`心愿「${id}」的 check 应为条件数组`); condErr++; }
}
if (!condErr) ok('cond / check 条件键全部合法');

/* ---------- 3. 跑通整局 ---------- */
console.log('\n[3] 引擎跑通一局');
function playOne(seed, strategy) {
  setSeed(seed);
  const S = newGame(db.aspirationIds[0]);
  let turns = 0;
  while (!S.ended && turns < 300) {
    const ev = pickEvent(S);
    if (!ev) { bad(`seed=${seed} 第 ${turns} 回合抽不到事件（年龄 ${S.age}）`); break; }
    choose(S, ev, strategy(S, ev));
    turns++;
  }
  return { S, turns };
}

const a = playOne(20240901, () => 'left');
if (a.S.ended) ok(`一路左滑：第 ${a.turns} 回合、${a.S.age} 岁结束 → 「${a.S.ended.t}」`);
else bad('一路左滑没能正常结束');

const survive = playOne(20240901, (S, ev) => {
  // 简易求生策略：哪边对最低属性的补益大就选哪边
  const lowest = db.mIds.reduce((lo, m) => S.stats[m] < S.stats[lo] ? m : lo, db.mIds[0]);
  const gain = opt => ((opt.fx || {})[lowest]) || 0;
  return gain(ev.left) >= gain(ev.right) ? 'left' : 'right';
});
if (survive.S.ended) {
  const sc = scoreOf(survive.S);
  ok(`求生策略：第 ${survive.turns} 回合、${survive.S.age} 岁结束 → 「${survive.S.ended.t}」，得分 ${sc}（${gradeOf(sc).g}）`);
} else bad('求生策略没能正常结束');

/* ---------- 4. 可复现 ---------- */
console.log('\n[4] 相同种子可复现');
const c = playOne(777, () => 'right');
const d = playOne(777, () => 'right');
if (c.turns === d.turns &&
    JSON.stringify(c.S.log) === JSON.stringify(d.S.log) &&
    JSON.stringify(c.S.stats) === JSON.stringify(d.S.stats)) {
  ok('seed=777 两次运行的履历与终局数值完全一致');
} else bad('seed=777 两次运行结果不一致，随机源不确定');

/* ---------- 5. 组合链可达性 ----------
 * 组合卡牌（宠物 / 家庭 / 事业）靠 flag 解锁。
 * 每有一个 cond 引用了某 flag，就必须有选项能把它置为真，否则这条链永远是死的。 */
console.log('\n[5] 组合链可达性');
const settable = new Set();
for (const e of db.events) {
  for (const side of ['left', 'right']) {
    const f = e[side] && e[side].flags;
    if (!f) continue;
    for (const [k, v] of Object.entries(f)) if (v) settable.add(k);
  }
}
const referenced = new Set();
for (const e of db.events) {
  const groups = e.cond ? (Array.isArray(e.cond) ? e.cond : [e.cond]) : [];
  for (const g of groups) if (g.flag) referenced.add(g.flag);
}
// retired / degree / peaked 由 rules.js 按年龄与数值自动写入，不依赖事件
const autoFlags = new Set(['retired', 'degree', 'peaked']);
const dead = [...referenced].filter(f => !settable.has(f) && !autoFlags.has(f));
if (dead.length) bad(`以下标记被 cond 引用，却没有任何选项能置为 true（组合链是死的）：${dead.join(', ')}`);
else ok(`${referenced.size} 个被依赖的人生标记都有来源，组合链不会走进死路`);

for (const [name, entryFlag, followFlag] of [
  ['宠物', 'pet', 'petDog'],
  ['家庭', 'married', 'hasChild'],
  ['事业', 'biz', 'bizSuccess']
]) {
  const hasEntry = db.events.some(e =>
    ['left', 'right'].some(s => e[s] && e[s].flags && e[s].flags[entryFlag]));
  const hasFollow = db.events.some(e => {
    const g = e.cond ? (Array.isArray(e.cond) ? e.cond : [e.cond]) : [];
    return g.some(x => x.flag === entryFlag || x.flag === followFlag);
  });
  if (hasEntry && hasFollow) ok(`${name}链完整：能拿到「${entryFlag}」，且有依赖它的后续卡牌`);
  else bad(`${name}链断裂：入口=${hasEntry} 后续=${hasFollow}`);
}

/* ---------- 6. 心愿可达成 ---------- */
console.log('\n[6] 心愿判定');
const T = tuning();
const aspCases = {
  rich:      { age: 40, stats: { money: 90 } },
  career:    { age: 40, stats: { career: 85, money: 65 } },
  longevity: { age: 78, stats: {} }
};
for (const id of Object.keys(aspCases)) {
  const conf = aspCases[id];
  const S = newGame(id);
  S.age = conf.age;
  Object.assign(S.stats, conf.stats);
  const ev = pickEvent(S);
  if (ev) choose(S, ev, 'left');
  if (S.aspirationDone) ok(`心愿「${db.aspirations[id].name}」在满足条件时判定为达成`);
  else bad(`心愿「${db.aspirations[id].name}」未能在满足条件时达成（age=${S.age}）`);
}
if (T.winAge > 0 && T.winAge <= 120) ok(`胜利年龄配置为 ${T.winAge} 岁`);

/* ---------- 汇总 ---------- */
console.log(failed === 0 ? '\n全部检查通过 ✅\n' : `\n有 ${failed} 项检查未通过 ❌\n`);
process.exit(failed === 0 ? 0 : 1);
