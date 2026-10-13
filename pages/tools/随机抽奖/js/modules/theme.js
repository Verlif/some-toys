/**
 * 主题（亮 / 暗）管理。
 * 只做一件事：把 <html data-theme="..."> 切到正确值，
 * 具体配色完全由 css/base/theme.css 的变量接管。
 */

const THEME_KEY = 'drawTheme';
const LEGACY_KEY = 'darkMode';

const LABELS = {
    light: { icon: '🌙', text: '暗色模式' },
    dark: { icon: '☀️', text: '亮色模式' },
};

let current = 'light';

/** 读取用户偏好：新键 → 旧键迁移 → 跟随系统 */
function resolveInitialTheme() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'light' || saved === 'dark') return saved;

        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy === 'true') return 'dark';
        if (legacy === 'false') return 'light';
    } catch (error) {
        console.error('读取主题偏好失败:', error);
    }

    const prefersDark = window.matchMedia
        && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
}

/** 应用主题并同步按钮外观 */
export function applyTheme(theme, toggleEl) {
    current = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = current;

    try {
        localStorage.setItem(THEME_KEY, current);
    } catch (error) {
        console.error('保存主题偏好失败:', error);
    }

    if (!toggleEl) return;
    const meta = LABELS[current];
    const icon = toggleEl.querySelector('.theme-toggle__icon');
    const label = toggleEl.querySelector('.theme-toggle__label');
    if (icon) icon.textContent = meta.icon;
    if (label) label.textContent = meta.text;
    toggleEl.setAttribute('aria-pressed', current === 'dark' ? 'true' : 'false');
    toggleEl.setAttribute('aria-label', meta.text);
}

/** 在应用启动时初始化主题 */
export function initTheme(toggleEl) {
    applyTheme(resolveInitialTheme(), toggleEl);
}

/** 在亮 / 暗之间切换 */
export function toggleTheme(toggleEl) {
    applyTheme(current === 'dark' ? 'light' : 'dark', toggleEl);
}
