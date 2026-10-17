/* =========================================================
   race.js — 圈数 / 进度 / 排名 / 完赛判定
   ========================================================= */
(function (DRC) {
  'use strict';

  /**
   * 根据最近采样点更新圈数与进度。
   * 正向越过起终点线计一圈；倒车过线撤销一圈（防刷圈）。
   * 过线时顺带记录单圈用时，供结算页统计。
   * 调用前 collision.js 已刷新 car.nearIdx。
   */
  function updateProgress(cars, track, totalLaps, time) {
    const n = track.n;

    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const cur = c.nearIdx;
      const prev = c.trackIdx;

      if (prev > n * 0.7 && cur < n * 0.3 && c.speed > 0) {
        if (!c.crossed) {
          c.crossed = true;
          c.lapStart = time;          // 第一次过线开始计圈
        } else {
          const lapTime = Math.max(0.01, time - c.lapStart);
          c.lapTimes.push(lapTime);
          if (!c.bestLap || lapTime < c.bestLap) c.bestLap = lapTime;
          c.lap++;
          c.lapStart = time;
        }
      } else if (prev < n * 0.3 && cur > n * 0.7 && c.speed < 0 && c.lap > 0) {
        c.lap--;
        if (c.lapTimes.length) c.lapTimes.pop();
      }

      c.trackIdx = cur;
      // 还没过线的车进度记为负（发车格在起终点之前），
      // 否则首圈里"没过线的"会排到"刚过线的"前面
      c.progress = c.crossed ? c.lap * n + cur : cur - n;

      if (!c.finished && c.lap >= totalLaps) {
        c.finished = true;
        c.finishTime = time;
      }
    }
  }

  /** 排名：已完赛按完赛时间，未完赛按赛道进度 */
  function sortByRank(cars) {
    return cars.slice().sort(function (a, b) {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  /** 写回 rank 并返回排序后的数组 */
  function updateRanks(cars) {
    const sorted = sortByRank(cars);
    for (let i = 0; i < sorted.length; i++) sorted[i].rank = i + 1;
    return sorted;
  }

  DRC.Race = {
    updateProgress: updateProgress,
    sortByRank: sortByRank,
    updateRanks: updateRanks,
  };
})(window.DRC);
