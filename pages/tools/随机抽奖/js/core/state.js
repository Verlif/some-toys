/**
 * 全局共享状态。
 * 集中管理所有可变量，避免散落的模块级变量与隐式耦合。
 */
export const state = {
    /** @type {{content: string, weight: number}[]} 抽奖项目 */
    items: [],

    /** @type {{result: string, timestamp: string}[]} 抽奖历史 */
    history: [],

    /** @type {string[]} 按权重展开后的抽奖池 */
    weighted: [],

    /** 滚动速度 1-8，数值越大滚动越快 */
    scrollSpeed: 3,

    /** 历史排序方式：'time' | 'frequency' */
    sortMode: 'time',

    /** 是否正在滚动 */
    isScrolling: false,

    /** 滚动轨道的当前 top 值 */
    currentTop: 0,

    /** 连抽过程中是否已被请求停止 */
    stopRequested: false,
};
