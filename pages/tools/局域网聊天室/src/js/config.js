/**
 * config.js — 全局常量配置
 * 所有可调参数集中在此，避免散落在业务代码里
 */

/** STUN 服务器（局域网内直连时通常用不到，保留以便跨网段回退） */
export const ICE_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

/** DataChannel 名称 */
export const CHANNEL_LABEL = 'chat';

/** 文件分块大小（16KB，兼顾兼容性与吞吐） */
export const CHUNK_SIZE = 16 * 1024;

/** 发送文件时的缓冲区高水位，超过则等待（流控） */
export const BUFFER_HIGH_WATER = 1024 * 1024;

/** 等待 ICE 收集完成的最长时间（非 trickle 模式） */
export const ICE_GATHER_TIMEOUT = 4000;

/** 超过该体积的文件发送前给出警告 */
export const MAX_FILE_WARN = 500 * 1024 * 1024;

/** 信令码前缀：SIG1 = gzip + base64，SIG0 = base64 降级 */
export const CODE_PREFIX = /^SIG[01]:/;

/** 昵称在 localStorage 中的键名 */
export const STORAGE_NAME_KEY = 'lan-chat-name';

/** 分享链接里承载信令码的参数名（二维码与「复制链接」共用） */
export const URL_CODE_PARAM = 'code';

/** 昵称长度上限（本地保存与对方广播都按此截断） */
export const NAME_MAX_LENGTH = 20;

/**
 * 图片扩展名白名单
 * 对端没带 MIME 时（例如旧版本发来的文件）按扩展名兜底判断能否直接预览
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'];

/** 文件进度渲染节流间隔（毫秒） */
export const PROGRESS_THROTTLE = 100;

/** 二维码绘制参数 */
export const QR = {
  /** 纠错等级：L 容量最大，容纳更长的 SDP（提高等级会让矩阵更密，反而更难扫） */
  errorCorrectionLevel: 'L',
  /** 静默区宽度（模块数） */
  quietZone: 2,
  /** 主面板里的最大显示边长（CSS px） */
  maxDisplaySize: 340,
  /** 窄屏时显示边长占视口宽度的比例 */
  displayViewportRatio: 0.78,
  /** 放大遮罩里的最大显示边长 */
  maxZoomSize: 720,
  /** 模块数超过该值时提示用户放大后再扫 */
  denseThreshold: 100
};

/** 摄像头扫描参数 */
export const SCANNER = {
  /**
   * 中心裁剪后送入识别的最长边。
   * 取 1080 后，常见的 720p / 1080p 摄像头裁剪出来都不需要再缩放，
   * 避免整帧缩放把本就不多的模块像素进一步稀释。
   */
  decodeMaxEdge: 1080,
  /** 每秒最多识别次数 */
  fps: 12,
  /** 图片识别的最大边长（图片里二维码位置不确定，按整图识别） */
  imageMaxEdge: 1600,
  /** 连续多久没识别到就给一句操作提示（毫秒） */
  hintAfterMs: 3000
};
