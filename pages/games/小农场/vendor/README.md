# vendor/ · 第三方代码

## webconnect.js

- 包名：`webconnect`（npm）
- 版本：**0.0.12**
- 来源：`https://cdn.jsdelivr.net/npm/webconnect@0.0.12/dist/esm/webconnect.js`
- 上游：https://github.com/nuzulul/webConnect.js
- 许可：**MIT**（Copyright © Nuzulul Zulkarnain）
- 大小：446,793 字节（未压缩，单文件 ESM，内含 Trystero）

### 为什么不走 CDN

游戏本身要求「零运行时依赖、不联网也能开发」。这个库只在**加入村镇**时才会被
`import()`，但把文件放在仓库里可以避免 CDN 抽风导致联机功能整个不可用。
升级时直接替换本文件，并在 `docs/14-村镇联机.md` 里更新版本号。

MIT 许可要求保留版权与许可声明，原文：

```
MIT License

Copyright (c) Nuzulul Zulkarnain

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
