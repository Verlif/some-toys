# 无头测试

这些脚本用 DOM / 时间的桩（`dom-stub.mjs`）在 Node 里直接把游戏跑起来，
不需要浏览器、不需要构建。**改动游戏逻辑后先跑一遍**，比手点快得多。

## 运行

```bash
# 碰撞手感（贴墙滑动 / 进通道 / 穿模 / 随机压力）
node --experimental-default-type=module tests/collision.mjs

# 道具 + 联机会话（房主 / 客户端 走回环传输）
node --experimental-default-type=module tests/features.mjs

# 端到端冒烟：完整打一局（倒计时 → 对局 → 道具 → 抓捕 → 结算 → 回放）
node --experimental-default-type=module tests/smoke.mjs

# AI 行为测量：可见晃动 / 卡顿（可带参数：局数 每局秒数 轨迹条数）
node --experimental-default-type=module tests/jitter.mjs 5 40 0
```

`--experimental-default-type=module` 是为了让 Node 把这些 `.js` 当成 ES Module
（项目没有 package.json，浏览器端不需要这个参数）。

## 说明

- `dom-stub.mjs` 必须在 `import` 游戏代码**之前**加载，它提供 `document` / `window` /
  `requestAnimationFrame` / `performance` 的最小实现，并用假时钟驱动主循环。
- `jitter.mjs` 的判定口径：0.6 秒窗口内振幅 > 4px、路径长度 > 2.5×振幅、净位移 < 0.8×振幅
  → 记一次「可见晃动」；连续 1 秒有路却走不动 → 记一次「卡死 episode」。
- 这些脚本不进游戏包体，也不会被 `index.html` 加载，纯开发用。
