/**
 * ui/connect-modals.js — 「创建连接」与「接受连接」两个向导
 *
 * 二维码与扫码的分工：
 *   生成邀请码 / 应答码  -> 面板内同步渲染二维码（内容为「本页链接 + #code=信令码」）
 *   读取对方的码         -> 输入框旁的「扫描二维码」，识别后自动填入
 *
 * 码输入框的容错：直接粘贴裸码、粘贴分享链接、粘贴带说明文字或换行的内容都能识别，
 * 粘贴后会自动归一化成裸码，所以不存在「粘进去了按钮却不亮」的情况。
 */
import {
  completeConnection,
  createAnswerCode,
  createOfferCode,
  discardPendingAnswer,
  discardPendingOffer
} from '../core/connection.js';
import { buildShareUrl, decodePayload, extractSignalCode, isSignalCode } from '../core/signaling.js';
import { openQRZoom, renderQRBlock } from '../qr/qr-render.js';
import { openScanner } from '../qr/qr-scan.js';
import { EV, on } from '../utils/bus.js';
import { copyText } from '../utils/clipboard.js';
import { $, on as listen, setHidden, setText } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';
import { closeModal, isModalOpen, onModalClose, openModal } from './modal.js';

/** 最近一次生成的码，供复制 / 复制链接使用 */
let offerCode = '';
let answerCode = '';

/** 二维码面板的 DOM 引用（避免每处重复书写） */
const offerQrRefs = () => ({
  canvasWrap: $('offerQr'),
  zoomBtn: $('offerQrZoomBtn'),
  hint: $('offerQrHint')
});
const answerQrRefs = () => ({
  canvasWrap: $('answerQr'),
  zoomBtn: $('answerQrZoomBtn'),
  hint: $('answerQrHint')
});

export function initConnectModals() {
  /* ---------- 入口按钮 ---------- */
  listen($('btnCreate'), 'click', () => {
    resetCreateModal();
    openModal('createModal');
  });

  listen($('btnAccept'), 'click', () => {
    resetAcceptModal();
    openModal('acceptModal');
  });

  /* ---------- 创建流程 ---------- */
  listen($('genOfferBtn'), 'click', generateOffer);
  listen($('copyOfferBtn'), 'click', () => copyWithToast(offerCode, '邀请码'));
  listen($('copyOfferLinkBtn'), 'click', () => copyShareLink(offerCode, '邀请码'));
  listen($('offerQrZoomBtn'), 'click', () => zoomQr($('offerQrBlock')));
  listen($('offerQr'), 'click', () => zoomQr($('offerQrBlock')));
  listen($('scanAnswerBtn'), 'click', () => {
    startScan('扫描对方的应答码', 'answerBox', '应答码', $('answerBoxHint'), refreshFinishState);
  });
  listen($('finishBtn'), 'click', finishConnection);

  /* ---------- 接受流程 ---------- */
  listen($('genAnswerBtn'), 'click', generateAnswer);
  listen($('copyAnswerBtn'), 'click', () => copyWithToast(answerCode, '应答码'));
  listen($('copyAnswerLinkBtn'), 'click', () => copyShareLink(answerCode, '应答码'));
  listen($('answerQrZoomBtn'), 'click', () => zoomQr($('answerQrBlock')));
  listen($('answerQr'), 'click', () => zoomQr($('answerQrBlock')));
  listen($('scanOfferBtn'), 'click', () => {
    startScan('扫描对方的邀请码', 'incomingOfferBox', '邀请码', $('acceptFlowHint'), refreshAnswerState);
  });

  /* ---------- 码输入框 ---------- */
  bindCodeBox($('answerBox'), refreshFinishState, $('answerBoxHint'), '应答码');
  bindCodeBox($('incomingOfferBox'), refreshAnswerState, $('acceptFlowHint'), '邀请码');

  /* ---------- 关闭时清理未完成的协商 ---------- */
  onModalClose('createModal', () => discardPendingOffer());
  onModalClose('acceptModal', () => discardPendingAnswer());

  /* ---------- 连接建立后自动收起向导 ---------- */
  on(EV.PEER_ONLINE, () => {
    setTimeout(() => {
      if (isModalOpen('createModal')) closeModal('createModal');
      if (isModalOpen('acceptModal')) closeModal('acceptModal');
    }, 300);
  });

  refreshFinishState();
  refreshAnswerState();
}

/**
 * 启动时检查地址栏是否带着信令码（扫码打开本页的场景）
 * @returns {Promise<boolean>} 是否成功接管
 */
export async function applyCodeFromUrl() {
  const code = extractSignalCode(window.location.href);
  if (!isSignalCode(code)) return false;

  // 用掉之后清掉地址栏里的码，避免刷新时重复触发
  clearUrlCode();

  let data;
  try {
    data = await decodePayload(code);
  } catch (e) {
    showToast('链接里的码无法解析：' + ((e && e.message) || '未知错误'));
    return false;
  }

  if (data.type === 'offer') {
    resetAcceptModal();
    $('incomingOfferBox').value = code;
    clearHint($('acceptFlowHint'));
    refreshAnswerState();
    openModal('acceptModal');
    showToast('✓ 已从链接读取邀请码，点「生成应答码」继续');
    return true;
  }

  if (data.type === 'answer') {
    resetCreateModal();
    setHidden($('cStep3'), false);
    $('answerBox').value = code;
    refreshFinishState();

    // 应答码只有对应的发起方能用，而页面刷新后协商上下文已丢失
    setHidden($('createFlowHint'), false);
    setText(
      $('createFlowHint'),
      '注意：链接里是「应答码」。完成连接需要由发起方在同一页面完成 —— ' +
      '请回到发起连接的页面，用「扫描二维码」读取这段应答码。'
    );

    openModal('createModal');
    showToast('已读取应答码，但它属于发起方那一侧');
    return true;
  }

  return false;
}

/* ============================================================
 *  码输入框：读取、校验、归一化
 * ============================================================ */

/** 读取输入框里可直接使用的信令码（自动兼容分享链接与杂质） */
function readBoxCode(box) {
  return box ? extractSignalCode(box.value).trim() : '';
}

/**
 * 绑定码输入框
 *   - 输入时实时刷新按钮可用状态
 *   - 粘贴 / 失焦时把内容归一化成裸码，并在不合法时给出明确提示
 * @param {HTMLTextAreaElement} box
 * @param {Function} refresh 刷新按钮状态
 * @param {HTMLElement} hintEl 校验提示元素
 * @param {string} label 码的中文名
 */
function bindCodeBox(box, refresh, hintEl, label) {
  if (!box) return;

  listen(box, 'input', () => {
    refresh();
    if (!box.value.trim()) clearHint(hintEl);
  });

  const normalize = () => {
    if (box.value.trim()) {
      const code = readBoxCode(box);
      if (code && code !== box.value) box.value = code;
    }

    refresh();

    if (box.value.trim() && !isSignalCode(box.value)) {
      setHint(
        hintEl,
        '这段内容不是有效的' + label +
        '（应以 SIG0: 或 SIG1: 开头，也可以直接粘贴「分享链接」）'
      );
    } else {
      clearHint(hintEl);
    }
  };

  listen(box, 'change', normalize);
  // 粘贴要等浏览器把内容写进输入框之后再处理
  listen(box, 'paste', () => setTimeout(normalize, 0));
}

function setHint(el, text) {
  if (!el) return;
  setText(el, text);
  setHidden(el, !text);
}

function clearHint(el) {
  setHint(el, '');
}

/* ============================================================
 *  扫码 / 复制
 * ============================================================ */

/**
 * 打开扫码遮罩，识别成功后把提取出的信令码填进指定输入框
 * @param {string} title      遮罩标题
 * @param {string} targetId   目标输入框 id
 * @param {string} label      码的中文名，仅用于提示文案
 * @param {HTMLElement} hintEl 校验提示元素
 * @param {Function} afterFill 填入后的回调（刷新按钮可用状态）
 */
function startScan(title, targetId, label, hintEl, afterFill) {
  openScanner({
    title,
    onResult: (text) => {
      const box = $(targetId);
      if (!box) return;

      // 扫到分享链接时只取其中的信令码
      const value = extractSignalCode(text).trim();
      box.value = value;

      if (isSignalCode(value)) {
        clearHint(hintEl);
        showToast('✓ 已读取' + label);
      } else {
        setHint(hintEl, '扫到的内容不是有效的' + label);
        showToast('已读取内容，但看起来不是' + label);
      }

      if (typeof afterFill === 'function') afterFill();
    }
  });
}

/** 放大二维码面板里的码；没渲染出来时不做任何事 */
function zoomQr(blockEl) {
  const text = blockEl && blockEl.dataset.qrText;
  if (!text) return;
  openQRZoom(text);
}

async function copyWithToast(text, label) {
  if (!text) {
    showToast('还没有生成' + label);
    return;
  }
  const ok = await copyText(text);
  showToast(ok ? '✓ ' + label + '已复制' : '复制失败，请手动选择复制');
}

/** 复制「本页链接 + 码」，对方点开即可直达并自动填码 */
async function copyShareLink(code, label) {
  if (!code) {
    showToast('还没有生成' + label);
    return;
  }

  const url = buildShareUrl(code);
  if (!url) {
    showToast('当前环境不支持生成链接，请改用二维码或直接复制' + label);
    return;
  }

  const ok = await copyText(url);
  showToast(ok ? '✓ 链接已复制，对方打开即自动填入' : '复制失败，请手动选择复制');
}

/** 清掉地址栏里的 #code=... */
function clearUrlCode() {
  if (typeof window.history.replaceState !== 'function') return;
  const loc = window.location;
  window.history.replaceState(null, '', loc.origin + loc.pathname + loc.search);
}

/* ============================================================
 *  创建连接：生成邀请码 -> 读取应答码 -> 完成
 * ============================================================ */

function resetCreateModal() {
  offerCode = '';

  $('cStep1').classList.remove('done');
  $('cStep2').classList.remove('done');
  $('cStep3').classList.remove('done');

  setHidden($('cStep1'), false);
  setHidden($('cStep2'), true);
  setHidden($('cStep3'), true);

  $('offerBox').value = '';
  $('answerBox').value = '';
  $('genOfferBtn').disabled = false;
  $('genOfferBtn').textContent = '生成邀请码';
  $('finishBtn').disabled = true;
  $('finishBtn').textContent = '完成连接';

  clearHint($('answerBoxHint'));
  clearHint($('createFlowHint'));

  // 传空串即清空二维码面板
  renderQRBlock($('offerQrBlock'), '', offerQrRefs());
}

async function generateOffer() {
  const btn = $('genOfferBtn');
  btn.disabled = true;
  btn.textContent = '生成中...';

  try {
    const code = await createOfferCode();
    offerCode = code;

    $('offerBox').value = code;
    $('cStep1').classList.add('done');
    setHidden($('cStep2'), false);
    setHidden($('cStep3'), false);

    renderQRBlock($('offerQrBlock'), code, offerQrRefs());

    btn.textContent = '重新生成';
    btn.disabled = false;

    const ok = await copyText(code);
    showToast(ok ? '✓ 邀请码已生成并复制' : '邀请码已生成，请手动复制');
  } catch (e) {
    console.error(e);
    showToast('生成失败：' + ((e && e.message) || '未知错误'));
    btn.textContent = '生成邀请码';
    btn.disabled = false;
  }
}

function refreshFinishState() {
  const box = $('answerBox');
  const btn = $('finishBtn');
  if (!box || !btn) return;
  btn.disabled = !isSignalCode(readBoxCode(box));
}

async function finishConnection() {
  const btn = $('finishBtn');
  btn.disabled = true;
  btn.textContent = '连接中...';

  try {
    await completeConnection(readBoxCode($('answerBox')));

    $('cStep2').classList.add('done');
    $('cStep3').classList.add('done');
    closeModal('createModal');
    showToast('✓ 连接成功');
  } catch (e) {
    console.error(e);
    showToast('连接失败：' + ((e && e.message) || '未知错误'));
    btn.disabled = false;
    btn.textContent = '完成连接';
  }
}

/* ============================================================
 *  接受连接：读取邀请码 -> 生成应答码
 * ============================================================ */

function resetAcceptModal() {
  answerCode = '';

  $('aStep1').classList.remove('done');
  $('aStep2').classList.remove('done');

  setHidden($('aStep1'), false);
  setHidden($('aStep2'), true);

  $('incomingOfferBox').value = '';
  $('answerOutBox').value = '';
  $('genAnswerBtn').disabled = true;
  $('genAnswerBtn').textContent = '生成应答码';

  clearHint($('acceptFlowHint'));

  renderQRBlock($('answerQrBlock'), '', answerQrRefs());
}

function refreshAnswerState() {
  const box = $('incomingOfferBox');
  const btn = $('genAnswerBtn');
  if (!box || !btn) return;
  btn.disabled = !isSignalCode(readBoxCode(box));
}

async function generateAnswer() {
  const btn = $('genAnswerBtn');
  btn.disabled = true;
  btn.textContent = '生成中...';

  try {
    const code = await createAnswerCode(readBoxCode($('incomingOfferBox')));
    answerCode = code;

    $('answerOutBox').value = code;
    $('aStep1').classList.add('done');
    setHidden($('aStep2'), false);

    renderQRBlock($('answerQrBlock'), code, answerQrRefs());

    btn.textContent = '已生成';
    clearHint($('acceptFlowHint'));

    const ok = await copyText(code);
    showToast(ok ? '✓ 应答码已生成并复制，请发回给对方' : '应答码已生成，请手动复制');
  } catch (e) {
    console.error(e);
    showToast('生成失败：' + ((e && e.message) || '未知错误'));
    btn.textContent = '生成应答码';
    btn.disabled = false;
  }
}
