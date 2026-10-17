/* =========================================================
   ai-steer.js — NPC 的"转向驾驶员"
   只负责左右方向，不碰油门。
   瞄准点追踪（瞄准点已含弯心内切偏移）+ 贴墙修正 + 智能躲车
   + 并排横向分离（防起步互切与超车侧擦）。
   ========================================================= */
(function (DRC) {
  'use strict';

  const C = DRC.CONFIG;

  function decide(car, ctx) {
    if (car.reverseTimer > 0) {
      // 倒车中：掉头朝赛道 → 把车头摆回瞄准方向；
      // 贴着墙倒 → 朝赛道中心倒，避免笔直退回去再撞一次；
      // 其余（被车顶住）→ 反打脱开
      if (Math.abs(ctx.angleDiff) > 1.1) {
        // 倒车时转向手感反向：要让车头回正，输入与偏差反向
        return DRC.clamp(-ctx.angleDiff * 2.2, -1, 1);
      }
      if (ctx.wallGap < 60) {
        // lat > 0（偏右）给正输入，倒车时车头才会往左回正、车尾摆离右墙
        const edge = C.trackHalfWidth - car.wid * 0.5;
        return DRC.clamp(car.lat / edge, -1, 1) * 0.8;
      }
      let escape = -car.lastSteer * 0.8;
      if (Math.abs(escape) < 0.25) escape = 0.5;
      return escape;
    }

    // 1) 瞄准点追踪（偏差大时权重也大，掉头恢复优先）。
    //    增益随挡位变化：低挡位瞄不准但也不会打转
    let steer = DRC.clamp(ctx.angleDiff * C.aiSteerGain, -1, 1);

    const edge = C.trackHalfWidth - car.wid * 0.5;

    // 2) 贴墙修正：偏离中心越多，越主动往内打。
    //    只在车头还朝着墙时才正常力度修正——瞄准点已经朝回路中央时若再
    //    叠加，高速下两者相加打满舵，整车横穿赛道撞上对面墙。
    //    但已经贴近墙（哪怕车头平行于墙）也补一道弱修正：高速平行墙
    //    行驶时 headingToWall ≈ 0 抓不住微小偏差，而 570px/s 下一次
    //    偏差就是一次蹭墙，必须靠 lat 兜底拉回来
    const off = DRC.clamp(Math.abs(car.lat) / edge, 0, 1);
    if (ctx.headingToWall > 0.1) {
      steer = DRC.clamp(steer - Math.sign(car.lat) * off * 0.55, -1, 1);
    } else if (off > 0.82) {
      steer = DRC.clamp(steer - Math.sign(car.lat) * (off - 0.82) * 1.4, -1, 1);
    }

    // 3) 躲车：优先让开挡路的一侧；那一侧已经贴墙就让不开，
    //    若另一侧明显更宽，换到宽的一侧绕。被压得越久动作越坚决
    const b = ctx.blocker;
    if (b) {
      const roomLeft = edge + car.lat;
      const roomRight = edge - car.lat;
      let dodge = b.side >= 0 ? -1 : 1;          // 挡在右侧就往左让

      const room = dodge > 0 ? roomRight : roomLeft;
      const altRoom = dodge > 0 ? roomLeft : roomRight;
      if (room <= 26 && altRoom > 34) dodge = -dodge;

      const finalRoom = dodge > 0 ? roomRight : roomLeft;
      if (finalRoom > 26) {
        const weight = 1 - DRC.clamp(b.ahead / C.aiDodgeRange, 0, 1);
        // 绕行中超车决心兜底：已经切出去了，就别因为距离稍微拉远
        // 就收回方向——半途收手又滑回前车线后面，超车就废了
        const otPush = car.otTimer > 0 ? 0.45 : 0;
        const urge = Math.min(1, weight + car.blockTime * 0.25 + otPush);
        // 高速收敛：速度越快，同样的转角横移越远，
        // 全速下打满方向会横穿整条赛道（实测 whip-saw 撞墙），
        // 所以躲车权重随速度衰减并设上限，低速灵活性保留
        const spdF = 1 - 0.45 * DRC.clamp(ctx.spd / C.maxSpeed, 0, 1);
        steer = DRC.clamp(steer + dodge * 0.42 * urge * spdF, -1, 1);
      }
    }

    // 3.5) 并排横向分离（安全覆盖）：身旁有车（不限正前）就往外让。
    //   起步抢线、超车过半时两车会朝同一点收方向，横向以 ~50px/s
    //   互切——跟车与躲车都只管纵向前车，治不了这种贴面收敛。
    //   低挡位关闭：各管各的，擦碰自负。那一侧贴墙则不让（权重归零）
    const nb = C.aiSafety ? ctx.neighbor : null;
    if (nb) {
      const away = nb.side >= 0 ? -1 : 1;          // 车在右半就往左让
      const room = away > 0 ? edge + car.lat : edge - car.lat;
      if (room > 26) {
        // 与瞄准点层的避让同源：横向正在收拢时提前加力，别等贴身再救
        const w = DRC.clamp(1 - DRC.clamp(Math.abs(nb.side) / C.aiNeighborSide, 0, 1)
          + (nb.closing || 0) / 420, 0, 1);
        steer = DRC.clamp(steer + away * 0.5 * w, -1, 1);
      }
    }

    // 4) 打方向有惯性：单次决策最多转动 0.6；
    //    速度越高同样的转角横移越远，速率上限随速度收紧——
    //    高速下 -1 → +1 猛打一出，整车直接横穿赛道
    const maxDelta = 0.6 * (1 - 0.45 * DRC.clamp(ctx.spd / C.maxSpeed, 0, 1));
    const delta = DRC.clamp(steer - car.steerPlan, -maxDelta, maxDelta);
    return car.steerPlan + delta;
  }

  DRC.AISteer = { decide: decide };
})(window.DRC);
