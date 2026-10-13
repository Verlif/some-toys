/**
 * 纯统计函数：从历史记录里算出出现次数最多的项目。
 * 保持无副作用，避免 result / history 两个模块相互依赖。
 */

/**
 * @param {{result: string}[]} history
 * @returns {{item: string, count: number}[]} 并列第一的全部项目
 */
export function getMostFrequent(history) {
    if (!history.length) return [];

    const counts = new Map();
    history.forEach((entry) => {
        counts.set(entry.result, (counts.get(entry.result) || 0) + 1);
    });

    let maxCount = 0;
    counts.forEach((count) => {
        if (count > maxCount) maxCount = count;
    });

    const result = [];
    counts.forEach((count, item) => {
        if (count === maxCount) result.push({ item, count });
    });
    return result;
}
