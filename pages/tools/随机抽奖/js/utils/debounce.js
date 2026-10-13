/**
 * 防抖：在最后一次触发后延迟执行。
 * @param {(...args: any[]) => void} fn
 * @param {number} delay 毫秒
 */
export function debounce(fn, delay = 300) {
    let timerId = null;
    return function debounced(...args) {
        if (timerId !== null) clearTimeout(timerId);
        timerId = setTimeout(() => {
            timerId = null;
            fn.apply(this, args);
        }, delay);
    };
}
