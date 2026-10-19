/* =========================================================
   ai-throttle.js — NPC 的"前后驾驶员"
   只负责油门 / 刹车 / 倒车，不碰方向。
   风格激进：弯道按转向能力的物理上限给油，跟车距离可以压缩，
   绕行超车时不低于前车速度，直道目标就是尾速满值——离目标远就
   全油门，只有贴近目标时才按差距给"羽油门"，不会在目标附近
   来回全油 / 重刹地抖。
   弯道限速取两个上限的较小值：转向能力（v = ω × R）与横向抓地
   （v²/R ≤ 可用的横向加速度）。抓地这一项带两个档案参数：
   aiGripUse（允许用掉几成抓地）与 aiDriftCap（弯里允许滑到多大滑角），
   所以保守档在弯里几乎不甩尾，激进档能用漂移换更快的过弯速度。
   跟车安全距与刹车前视窗口同样由档案决定：保守提前一个刹车点收油、
   留足车距；激进贴到物理极限才介入。
   跟车安全距由挡位决定（aiFollowBase / aiFollowHead）：挡位越高
   跟得越近、越晚减速；绕行超车期间速度目标锁定正在超的那台车
   （含身侧与略后方），不会半程松油门。
   ========================================================= */
(function (DRC) {
  'use strict';

  const C = DRC.CONFIG;

  function decide(car, ctx) {
    // 贴墙卡死脱困：优先给油朝赛道中心挪，比倒车更快脱身
    if (car.wallStuck > 0) return 1;

    // 倒车中：节流也归前后驾驶员。贴墙倒车降速是基础车辆操作
    // （全速倒车尾部横扫半径大，容易扫到墙），所有挡位都生效
    if (car.reverseTimer > 0) {
      return ctx.wallGap < 60 ? -0.55 : -1;
    }

    // 1) 弯道限速：两个上限取小
    //    a) 转向能力：v = ω × R，ω = turnRate × 余量 × 车头对准程度 × 技能
    //    b) 横向抓地：过弯要 v²/R 的横向加速度，而轮胎能给的最大值受
    //       抓地上限与"允许滑到多大滑角"共同限制——保守档只用六成抓地
    //       且把滑角压到 0.16rad（远在留胎痕的 0.17 之下），所以它
    //       在弯里基本不甩；激进档抓地用满、滑角放到 0.64，
    //       同样的弯能多带三成速度，代价是甩尾掉速
    //    位次补偿只放大直道尾速——弯道物理上限是抓地力决定的，
    //    跟着名次一起放大会让车入弯太快、转向跟不上外抛蹭墙
    let target = C.maxSpeed * car.boost;
    let vCorner = Infinity;
    if (ctx.minRAhead < Infinity) {
      const R = ctx.minRAhead;
      const align = 1 - C.aiAlignLoss * DRC.clamp(Math.abs(ctx.angleDiff) / 0.8, 0, 1);
      // 技能系数只作用在弯道：新手"不敢压极限"是入弯收油，
      // 不是直道也跑不到全速。乘在整个 target 上会让低挡位的车
      // 在直路上永远只到全速的 72%~88%，看起来就是不敢踩
      const vSteer = C.turnRate * R * C.aiCornerMargin * align * car.skill;

      // 抓地上限按 vSteer 处的抓地折算（v 越小抓地越足），再除以
      // 允许的滑角：横向加速度 = 刚度 × 滑角，两者取小
      const grip = C.lateralGrip
        * (1 - C.lateralGripFalloff * DRC.clamp(vSteer / C.maxSpeed, 0, 1))
        * C.aiGripUse;
      const latAllow = Math.min(C.lateralStiff * Math.max(0.05, C.aiDriftCap), grip);
      const vGrip = Math.sqrt(latAllow * R);

      vCorner = Math.min(vSteer, vGrip);
      if (vCorner < target) target = vCorner;
    }

    // 2) 跟车：车距低于安全距时按差距配速——比前车慢多少由贴过去的幅度
    //    决定：贴得越紧让得越多，车距被稳定拉回安全距附近；
    //    车距充足时完全不做限制，全速接近，超车在弯道与直道上自然发生。
    //    安全距 = 基数 + 车头时距 × 车速 + 接近速度折算，再乘被压久的
    //    压缩（最多 aiOvertakeGap）——基数与时距由挡位决定，挡位越高
    //    跟得越近，不会离着老远就收油。
    //    只对正前方本车道内的车生效（|侧偏| < 64）：隔着一条道的车
    //    不构成追尾风险，为它减速是车距判断不准
    if (ctx.blocker && Math.abs(ctx.blocker.side) < 64) {
      const grip = 1 - C.aiOvertakeGap * DRC.clamp(car.blockTime / 2.5, 0, 1);
      const closing = Math.max(0, ctx.spd - ctx.blocker.speed);
      const safe = (C.aiFollowBase + ctx.spd * C.aiFollowHead + closing * 0.55) * grip;
      if (ctx.blocker.ahead < safe) {
        // err: 0 = 刚好在安全距，-1 = 贴住
        const err = DRC.clamp((ctx.blocker.ahead - safe) / safe, -1, 0);
        const vFollow = Math.max(0, Math.min(C.maxSpeed, ctx.blocker.speed + err * 90));
        if (vFollow < target) target = vFollow;
      }
    }

    // 2.5) 绕行超车中：目标速度至少「前车 + 余量」——绕出去就是要
    //     超过它，还按跟车配速慢慢晃永远没机会。积极性随挡位；
    //     目标车退到身侧 / 略后方时 ctx.blocker 会丢失，用 ctx.pass
    //     续上——半程松油门是最常见的超车失败原因。
    //     安全覆盖开启时紧急制动仍兜底（前车急刹也撞不上）
    if (car.otTimer > 0) {
      const t = ctx.blocker || ctx.pass;
      if (t) {
        let vOt = t.speed + 110 * DRC.clamp(C.aiOvertake, 0, 1);
        // 弯道里为超车可以稍微超速，但抓地力上限是物理的：顶着位次
        // 补偿硬冲只会入弯外抛蹭墙（实测补偿提到 20% 后撞墙明显上升）
        if (vCorner < Infinity) vOt = Math.min(vOt, vCorner * 1.12);
        if (vOt > target) target = vOt;
      }
    }

    // 3) 只有车头明显顶墙才收油；轻微贴墙交给转向驾驶员修正，
    //    不因为擦个边就把速度掉光
    if (ctx.headingToWall > 0.3 && ctx.wallGap < 40) {
      const vWall = C.maxSpeed * 0.55 * DRC.clamp(ctx.wallGap / 40, 0.2, 1);
      if (vWall < target) target = vWall;
    }

    // 3.5) 打转自救：侧滑角已经很大时先收油。车快横过来了还在给油，
    //      只会越转越快、越转越偏——低档位的反应间隔长，这种局面
    //      靠转向驾驶员是救不回来的（它下一次决策可能还在 0.3s 之后）。
    //      收油把横向力还给轮胎，行驶方向才有机会被拽回车头。
    //      这不改变任何档案的性格，只是"车要翻了别加油"。
    const spun = DRC.clamp((Math.abs(car.slip) - 0.40) / 0.35, 0, 1);
    if (spun > 0) {
      const vSpun = C.maxSpeed * (1 - 0.6 * spun);
      if (vSpun < target) target = vSpun;
    }

    // 4) 落地：离目标远就全油；接近目标时按差距给"羽油门"。
    //    旧写法在目标附近是「低于 97% 全油 / 高于 103% 重刹」的二值切换，
    //    而一次决策要持 0.14~0.24s——全油段能冲上去上百，重刹段又会掉
    //    回来，肉眼就能看到车速在目标附近来回跳。改成比例输出后，
    //    目标附近的修正幅度只有十几，速度贴着目标走
    const err = target - car.speed;
    if (err > 90) return 1;
    if (err >= 0) return Math.max(0.08, err / 90);      // 差一点：轻给油
    return DRC.clamp(err / 200, -1, -0.05);             // 超一点：轻收油
  }

  DRC.AIThrottle = { decide: decide };
})(window.DRC);
