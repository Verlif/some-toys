/**
 * 通用工具：数值夹取、插值、随机，以及圆角矩形与「田」字笔画几何。
 * 纯函数，不依赖任何游戏状态，可以单独测试。
 */

/* ================================================================
   工具
================================================================ */
export const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
export const lerp  = (a,b,t) => a + (b-a) * t;
export const rand  = (a,b) => a + Math.random() * (b-a);

export function roundRect(c, x, y, w, h, r){
  r = Math.min(r, Math.abs(w)/2, Math.abs(h)/2);
  c.beginPath();
  c.moveTo(x+r, y);
  c.lineTo(x+w-r, y);   c.arcTo(x+w, y, x+w, y+r, r);
  c.lineTo(x+w, y+h-r); c.arcTo(x+w, y+h, x+w-r, y+h, r);
  c.lineTo(x+r, y+h);   c.arcTo(x, y+h, x, y+h-r, r);
  c.lineTo(x, y+r);     c.arcTo(x, y, x+r, y, r);
  c.closePath();
}

export function strokeLength(stroke){
  let len = 0;
  for (let i = 0; i < stroke.length - 1; i++){
    const dx = stroke[i+1][0] - stroke[i][0];
    const dy = stroke[i+1][1] - stroke[i][1];
    len += Math.sqrt(dx*dx + dy*dy);
  }
  return len;
}

export function strokePointAt(stroke, t){
  const total = strokeLength(stroke);
  let remaining = t * total;
  for (let i = 0; i < stroke.length - 1; i++){
    const dx = stroke[i+1][0] - stroke[i][0];
    const dy = stroke[i+1][1] - stroke[i][1];
    const seg = Math.sqrt(dx*dx + dy*dy);
    if (remaining <= seg){
      const k = seg > 0 ? remaining / seg : 0;
      return [stroke[i][0] + dx * k, stroke[i][1] + dy * k];
    }
    remaining -= seg;
  }
  return stroke[stroke.length - 1];
}
