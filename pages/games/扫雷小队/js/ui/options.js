/**
 * 选项界面：分段按钮写入 settings，滑杆调整地雷数量，
 * 提示行实时显示本局的人数构成与入口数。
 */
import { settings } from '../core/state.js';

export function initOptions() {
  document.querySelectorAll('[data-setting]').forEach(group => {
    const key = group.dataset.setting;
    group.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settings[key] = parseInt(btn.dataset.value);
        updateOptionsHint();
      });
    });
  });

  setActive('playerCount', settings.playerCount);
  setActive('teamCount', settings.teamCount);
  setActive('teamSize', settings.teamSize);

  const slider = document.getElementById('mineSlider');
  const val = document.getElementById('mineVal');
  slider.value = settings.mineCount;
  val.textContent = settings.mineCount;
  slider.oninput = () => {
    settings.mineCount = parseInt(slider.value);
    val.textContent = settings.mineCount;
  };

  updateOptionsHint();
}

export function setActive(key, val) {
  const group = document.querySelector(`[data-setting="${key}"]`);
  if (!group) return;
  group.querySelectorAll('.btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.value) === val);
  });
}

export function updateOptionsHint() {
  const total = settings.teamCount * settings.teamSize;
  const humans = settings.playerCount;
  const ai = total - humans;
  const entrances = settings.teamCount + 2;
  document.getElementById('optionsHint').textContent =
    `共 ${settings.teamCount} 队 × ${settings.teamSize} 人 = ${total} 名角色（${humans} 玩家 + ${ai} AI）· ${entrances} 个迷宫入口`;
}
