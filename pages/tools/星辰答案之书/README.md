# 答案之书 · 星夜

一页星空，一句答案。纯前端 Canvas 项目，无任何依赖、无构建步骤。

画面由四层叠加而成：CSS 星云 → Canvas 星辰 / 流星 / 黑洞 → CSS 暗角 → 中心答案文本。
答案每 8~12 秒换一句；黑洞是一个中心纯黑、边缘渐变到透明的小球，它经过时星辰会先被
引力拽动、带着惯性加速冲过去，然后被吸积流拖进轨道绕行、拖出一条尾流，最后被吞没。

尾流不是"进入黑洞才长出来"的特效，而是**运动本身的痕迹**：
只按固定时间间隔记录位置点，所以快的东西尾巴长、慢的尾巴短，
静止时自然收缩成一点。星辰和流星用的都是同一套实现。

流星的速度刻意压得很慢 —— 真实流星在屏幕上只存在零点几秒，看到的只是一道
一闪而过的划痕；这里取 240~500 px/s，横穿画面要好几秒，角度才读得出来。

---

## 快速开始

**方式一：直接打开（零依赖）**

双击 `index.html` 即可。

> `file://` 协议下浏览器会拦截 `fetch`，页面会自动使用内置文案副本
> （`src/data/texts.fallback.js`），效果完全一致，只是不会热更新 `data/texts.txt`。

**方式二：本地服务器（推荐，改文案即时生效）**

```bash
npx --yes serve .
# 或
python -m http.server 8080
```

然后访问 `http://localhost:8080`。

---

## 目录结构

```
星辰答案之书/
├─ index.html                    页面骨架 + 脚本加载顺序（唯一入口）
├─ package.json                  构建脚本快捷方式
├─ README.md                     本文件
│
├─ data/
│  └─ texts.txt                  ★ 文案库：一行一段，# 为注释
│
├─ docs/
│  └─ DEVELOPMENT.md             开发文档：架构、渲染原理、扩展指南
│
├─ scripts/
   ├─ build-texts.mjs            从 texts.txt 生成内置文案副本
   ├─ check-syntax.mjs            全量语法静态校验（npm run check 的第一步）
   └─ audit-config.mjs            配置键引用审计（拼错键名会静默失效，靠它抓）
│
├─ styles/
│  ├─ base.css                   变量、重置、页面骨架
│  ├─ sky.css                    星云 / 画布 / 暗角
│  └─ text.css                   答案文本排版与淡入淡出
│
└─ src/
   ├─ config.js                  ★ 所有可调参数集中于此
   ├─ main.js                    入口：装配模块并驱动主循环
   │
   ├─ utils/
   │  ├─ math.js                 clamp / lerp / smoothstep / len
   │  └─ random.js               rand / randInt / randSign
   │
   ├─ core/
   │  ├─ viewport.js             画布尺寸与高 DPI 适配
   │  └─ loop.js                 requestAnimationFrame 主循环
   │
   ├─ data/
   │  ├─ texts.js                文案加载器（fetch + 回退）
   │  └─ texts.fallback.js       【自动生成】勿手工编辑
   │
   ├─ scene/
   │  ├─ sprites.js              星点光晕预渲染贴图
   │  ├─ trail.js                ★ 通用尾流：按时间采样位置点
   │  ├─ stars.js                星辰层：惯性积分 + 尾流
   │  ├─ meteors.js              流星层：角度 + 入射边 + 寿命由几何定
   │  └─ blackhole.js            黑洞层：引力 + 吸积流耦合 + 渐变黑球
   │
   └─ ui/
      └─ answer-text.js          答案文本的展示调度
```

---

## 常见改动

**换文案** —— 编辑 `data/texts.txt`（一行一段，`#` 开头为注释），然后：

```bash
npm run build:texts      # 等价于 node scripts/build-texts.mjs
```

这一步只是刷新 `file://` 下的内置副本。若你用本地服务器访问，改完 txt 刷新页面即可。

**调节奏** —— `src/config.js` 的 `text` 段：

| 参数 | 含义 | 当前值 |
| --- | --- | --- |
| `fadeMs` | 单次淡入 / 淡出时长 | `1500` |
| `holdMinMs` / `holdMaxMs` | 完全显现后的停留时长 | `5000` / `8000` |
| `gapMinMs` / `gapMaxMs` | 两条之间的空档 | `300` / `600` |

**调黑洞** —— `src/config.js` 的 `blackhole` 段：

| 参数 | 含义 |
| --- | --- |
| `radiusMin` / `radiusMax` | 黑球半径范围（像素） |
| `edgeSoft` | 边缘渐变带宽度（占 R）。中心到 `(1−edgeSoft)·R` 是纯黑，往外化开 |
| `influence` | 引力作用半径 = 黑球半径 × 该值 |
| `gm` | 引力强度。与半径联动，见 `docs/DEVELOPMENT.md` 4.7 |
| `soften` / `taper` | 引力软化尺度 / 作用半径处的收尾位置 |
| `flowCoupling` | 吸积流耦合速率。**越大越快被拽进轨道、轨道越小** |
| `flowRange` / `flowInner` | 耦合的作用范围 / 满强度位置（单位：黑球半径） |
| `flowInflow` | 目标速度占圆轨道速度的比例。<1 才会缓慢内落 |
| `intervalMinMs` / `intervalMaxMs` | 两次出现的间隔 |

> 改 `radiusMin/Max` 时请连带看 `docs/DEVELOPMENT.md` 4.7 —— `influence`、`gm`、
> `flowInner/Range` 都是以 R 为单位或与 R 挂钩的，只改半径会让引力场在像素尺度上
> 一起缩水，观感会完全变样。

**调流星** —— `src/config.js` 的 `meteors` 段：

| 参数 | 含义 |
| --- | --- |
| `speedMin` / `speedSpan` | 飞行速度。压得慢才看得出角度（当前 240~500） |
| `angleMinDeg` / `angleMaxDeg` | 与水平方向的夹角范围。陡的从上边进入、缓的从侧边进入 |
| `spawnPad` | 起点在画面外的余量（像素） |
| `trailSpan` | 尾流覆盖时长（秒）。**尾流长度 = 速度 × 该值** |
| `trailAlpha` / `trailWidth` | 尾流亮度 / 粗细 |
| `intervalMinMs` / `intervalMaxMs` | 两次出现的间隔 |

**调星辰与尾流** —— `src/config.js` 的 `stars` 段：

| 参数 | 含义 |
| --- | --- |
| `speedMin` / `speedSpan` | 基线漂移速度：星场在无人扰动时的流动快慢 |
| `relaxSec` | 脱离引力井后速度回归基线的时间常数。越小越黏 |
| `trailSpan` | 尾流覆盖时长（秒）。**尾流长度 = 速度 × 该值** |
| `trailSteps` | 采样点数，越多折线越平滑 |
| `trailMinSpeed` / `trailFullSpeed` | 低于前者完全无尾流，达到后者满亮度 |
| `trailAlpha` / `trailWidth` | 尾流亮度 / 粗细 |

其余参数见 `src/config.js` 内的逐项注释。

---

## 浏览器要求

Chrome / Edge / Safari / Firefox 近两年版本。依赖 Canvas 2D、CSS 自定义属性、
`Promise`、`async` 风格时序控制；`prefers-reduced-motion` 下会关闭星云漂移动画。

---

## 许可

MIT
