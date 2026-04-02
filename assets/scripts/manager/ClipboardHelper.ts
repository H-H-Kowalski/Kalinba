/**
 * 复制到剪贴板：微信小游戏用 wx.setClipboardData。
 * （已注释）浏览器 Clipboard API，仅 Web 预览用。
 */

import { getWx } from './WeChatNative';

export async function copyTextToClipboard(text: string): Promise<boolean> {
    const wxApi = getWx() as {
        setClipboardData?: (options: {
            data: string;
            success?: () => void;
            fail?: (err: unknown) => void;
        }) => void;
    } | undefined;
    if (wxApi && typeof wxApi.setClipboardData === 'function') {
        return await new Promise((resolve) => {
            wxApi.setClipboardData!({
                data: text,
                success: () => resolve(true),
                fail: () => resolve(false),
            });
        });
    }
    /* 微信小游戏发布：无 Clipboard API 回退
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // ignore
    }
    */
    return false;
}
