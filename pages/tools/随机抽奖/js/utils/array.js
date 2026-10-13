/**
 * 数组相关工具：洗牌与最大公约数。
 */

/** Fisher-Yates 洗牌，返回新数组，不改动入参。 */
export function shuffle(list) {
    const result = [...list];
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/** 两数最大公约数。 */
export function gcd(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y !== 0) {
        const temp = y;
        y = x % y;
        x = temp;
    }
    return x;
}

/**
 * 数组的最大公约数。
 * 用于把权重等比例缩小，避免抽奖池被超大权重撑爆。
 */
export function arrayGcd(values) {
    if (!values.length) return 1;
    const result = values.reduce((acc, value) => gcd(acc, value));
    return result || 1;
}
