/**
 * 轻触震动：微信小游戏 wx.vibrateShort。
 * （已注释）浏览器 Vibration API。
 * https://developers.weixin.qq.com/minigame/dev/api/device/vibrate/wx.vibrateShort.html
 */

import { getWx } from './WeChatNative';

/** 全局节流：双指同时按会触发两次 vibrateShort，真机马达叠在一起容易发涩、像被「阻碍」 */
let lastKeyVibrateAtMs = 0;
const KEY_VIBRATE_MIN_INTERVAL_MS = 45;

function nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

/** 琴键等短促反馈，尽量轻；多键同时按只震一次（见 KEY_VIBRATE_MIN_INTERVAL_MS） */
export function vibrateKeyTap(): void {
    const t = nowMs();
    if (t - lastKeyVibrateAtMs < KEY_VIBRATE_MIN_INTERVAL_MS) {
        return;
    }
    lastKeyVibrateAtMs = t;

    const wxApi = getWx() as { vibrateShort?: (o?: { type?: 'heavy' | 'medium' | 'light' }) => void } | undefined;
    if (wxApi && typeof wxApi.vibrateShort === 'function') {
        try {
            wxApi.vibrateShort({ type: 'light' });
        } catch {
            try {
                wxApi.vibrateShort();
            } catch {
                // ignore
            }
        }
        return;
    }
    /* 微信小游戏发布：无 navigator.vibrate 回退
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(12);
        }
    } catch {
        // ignore
    }
    */
}
