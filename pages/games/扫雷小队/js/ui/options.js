/**
 * 选项界面：分段按钮写入 settings，滑杆调整地雷数量，
 * 提示行实时显示本局的人数构成、入口数与双人阵容。
 *
 * 设置之间有联动：双人「并肩同队」需要队内至少两个座位，
 * 所以每次改动后都走一遍 syncOptions() 统一刷新可用状态与文案。
 */
import { TEAM_NAMES, PLAYER_TEAM_SAME, PLAYER_TEAM_SPLIT } from '../core/config.js';
import { settings } from '../core/state.js';

const NUMERIC = /^-?\d+$/;

export function initOptions() {
  document.querySelectorAll('[data-setting]').forEach(group => {
    const key = group.dataset.setting;
    group.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        group.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settings[key] = parseValue(btn.dataset.value);
        syncOptions();
      });
    });
  });

  const slider = document.getElementById('mineSlider');
  const val = document.getElementById('mineVal');
  slider.value = settings.mineCount;
  val.textContent = settings.mineCount;
  slider.oninput = () => {
    settings.mineCount = parseInt(slider.value, 10);
    val.textContent = settings.mineCount;
  };

  syncOptions();
}

function parseValue(raw) {
  return NUMERIC.test(raw) ? parseInt(raw, 10) : raw;
}

export function setActive(key, val) {
  const group = document.querySelector(`[data-setting="${key}"]`);
  if (!group) return;
  group.querySelectorAll('.btn').forEach(b => {
    b.classList.toggle('active', parseValue(b.dataset.value) === val);
  });
}

/** 约束联动 + 刷新所有控件的可用状态与提示文案 */
export function syncOptions() {
  const duo = settings.playerCount === 2;
  const canSame = duo && settings.teamSize >= 2;

  // 队内只剩一个座位时同队不成立，退回各带一队
  if (settings.playerTeams === PLAYER_TEAM_SAME && !canSame) {
    settings.playerTeams = PLAYER_TEAM_SPLIT;
  }

  const sameBtn = document.querySelector('[data-setting="playerTeams"] .btn[data-value="same"]');
  if (sameBtn) {
    sameBtn.disabled = !canSame;
    sameBtn.title = canSame ? '' : '每队 1 人时两队各只有一个座位，无法同队';
  }

  const row = document.getElementById('rowPlayerTeams');
  if (row) row.classList.toggle('hidden', !duo);

  setActive('playerCount', settings.playerCount);
  setActive('teamCount', settings.teamCount);
  setActive('teamSize', settings.teamSize);
  setActive('playerTeams', settings.playerTeams);

  const note = document.getElementById('playerTeamsNote');
  if (note) {
    if (!duo) note.textContent = '';
    else if (settings.playerTeams === PLAYER_TEAM_SAME) {
      note.textContent =
        `两人同属${TEAM_NAMES[0]}：共用一份视野与情报，夺旗 / 排雷的减秒两人共享，队伍成绩合并计算。`;
    } else {
      note.textContent =
        `P1 带${TEAM_NAMES[0]}、P2 带${TEAM_NAMES[1]}：两队各自记分，总用时更短的一队获胜。`;
    }
  }

  updateOptionsHint();
}

export function updateOptionsHint() {
  const total = settings.teamCount * settings.teamSize;
  const humans = settings.playerCount;
  const ai = total - humans;
  const entrances = settings.teamCount + 2;

  let text = `共 ${settings.teamCount} 队 × ${settings.teamSize} 人 = ${total} 名角色` +
             `（${humans} 玩家 + ${ai} AI）· ${entrances} 个迷宫入口`;

  if (humans === 2) {
    text += settings.playerTeams === PLAYER_TEAM_SAME
      ? `\n双人并肩：P1 + P2 同属${TEAM_NAMES[0]}，另有 ${settings.teamSize - 2} 名 AI 队友`
      : `\n双人对抗：P1 在${TEAM_NAMES[0]} · P2 在${TEAM_NAMES[1]}`;
  }

  document.getElementById('optionsHint').textContent = text;
}
