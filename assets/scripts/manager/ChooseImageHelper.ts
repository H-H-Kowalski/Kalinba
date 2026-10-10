/**
 * 本地图片选择（微信小游戏）
 *
 * 图片优先使用 wx.chooseImage：
 * https://developers.weixin.qq.com/minigame/dev/api/media/image/wx.chooseImage.html
 * 没有该能力时使用 wx.chooseMedia：
 * https://developers.weixin.qq.com/minigame/dev/api/media/video/wx.chooseMedia.html
 *
 * 选中后 tempFilePath 可交给 assetManager.loadRemote 等加载为纹理。
 */

import { getWx } from './WeChatNative';
import { requestImagePrivacyAuthorization } from './WeChatPrivacyAuthorization';

export { getWx };

type WxChooseImageOptions = {
    count?: number;
    sizeType?: string[];
    sourceType?: ('album' | 'camera')[];
    success?: (res: { tempFilePaths: string[]; tempFiles?: Array<{ path: string; size: number }> }) => void;
    fail?: (err: unknown) => void;
};

type WxChooseMediaOptions = {
    count?: number;
    mediaType?: string[];
    sourceType?: ('album' | 'camera')[];
    sizeType?: string[];
    success?: (res: { tempFiles?: Array<{ tempFilePath?: string }> }) => void;
    fail?: (err: unknown) => void;
};

export interface ChooseImageResult {
    ok: boolean;
    tempFilePath?: string;
    tempFilePaths?: string[];
    errMsg?: string;
}

/** 能否在微信里调起选图（chooseMedia 或 chooseImage 任一可用） */
export function isWeChatMiniGame(): boolean {
    const w = getWx() as { chooseMedia?: unknown; chooseImage?: unknown } | undefined;
    if (!w) return false;
    return typeof w.chooseMedia === 'function' || typeof w.chooseImage === 'function';
}

function normalizeSourceType(sourceType?: 'album' | 'camera'): ('album' | 'camera')[] {
    return sourceType ? [sourceType] : ['album', 'camera'];
}

/** 微信 fail 常为对象；控制台 [object Object] 时需展开 errMsg / errno */
function formatWxChooseErr(err: unknown): string {
    if (err == null) {
        return '选择失败';
    }
    if (typeof err === 'string') {
        return err;
    }
    if (typeof err === 'object') {
        const o = err as { errMsg?: string; errno?: number; message?: string };
        const base = o.errMsg || o.message || JSON.stringify(err);
        if (o.errno === 1026 || /1026|privacy|隐私|用户隐私|未声明/i.test(base)) {
            return `${base}（请在微信公众平台：设置 → 基本设置 → 用户隐私保护指引 中声明相册/摄像头用途）`;
        }
        return base;
    }
    return String(err);
}

/**
 * 微信内选图：优先 chooseImage，未实现时使用 chooseMedia；取消/拒绝授权不重开选择器。
 */
function pickWechatImagePaths(
    count: number,
    sourceType?: 'album' | 'camera',
): Promise<{ ok: boolean; paths: string[]; errMsg?: string }> {
    return new Promise((resolve) => {
        let settled = false;
        let cancelPrivacy: (() => void) | undefined;
        const finish = (result: { ok: boolean; paths: string[]; errMsg?: string }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cancelPrivacy?.();
            resolve(result);
        };
        const timer = setTimeout(() => finish({ ok: false, paths: [], errMsg: '选择图片超时' }), 120000);
        const finishPaths = (paths: unknown) => {
            if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string' || !p.trim())) {
                finish({ ok: false, paths: [], errMsg: '未能读取选择的图片' });
                return;
            }
            finish({ ok: true, paths: paths.slice(0, count) });
        };
        const w = getWx() as {
            chooseMedia?: (o: WxChooseMediaOptions) => void;
            chooseImage?: (o: WxChooseImageOptions) => void;
        };
        if (!w) {
            finish({ ok: false, paths: [], errMsg: 'wx 不可用' });
            return;
        }
        const st = normalizeSourceType(sourceType);
        const finishFail = (err: unknown) => {
            finish({ ok: false, paths: [], errMsg: formatWxChooseErr(err) });
        };

        let pickerOpened = false;
        const openPicker = () => {
            // 授权的重复/迟到回调不能重开相册或在已超时的操作中继续选图。
            if (settled || pickerOpened) return;
            pickerOpened = true;
            try {
                if (typeof w.chooseImage === 'function') {
                    w.chooseImage({
                        count,
                        sizeType: ['original', 'compressed'],
                        sourceType: st,
                        success(res) { finishPaths(res?.tempFilePaths); },
                        fail: finishFail,
                    });
                    return;
                }

                if (typeof w.chooseMedia === 'function') {
                    w.chooseMedia({
                        count,
                        mediaType: ['image'],
                        sizeType: ['original', 'compressed'],
                        sourceType: st,
                        success(res) {
                            finishPaths(Array.isArray(res?.tempFiles) ? res.tempFiles.map(f => f?.tempFilePath) : undefined);
                        },
                        fail: finishFail,
                    });
                    return;
                }

                finish({ ok: false, paths: [], errMsg: '不支持选图 API' });
            } catch (error) { finishFail(error); }
        };
        try {
            cancelPrivacy = requestImagePrivacyAuthorization(openPicker,
                err => finishFail(`隐私授权未完成：${formatWxChooseErr(err)}`));
            if (settled) cancelPrivacy();
        } catch (error) { finishFail(error); }
    });
}

/**
 * 打开相册/相机选择一张本地图片（仅微信小游戏）
 */
export function chooseImage(sourceType?: 'album' | 'camera'): Promise<ChooseImageResult> {
    return pickWechatImagePaths(1, sourceType).then((r) => {
        if (!r.ok) {
            return { ok: false, errMsg: r.errMsg || '选择失败' };
        }
        return {
            ok: true,
            tempFilePath: r.paths[0],
            tempFilePaths: r.paths,
        };
    });
}

/**
 * 选择多张图片（最多 9 张）
 */
export function chooseImageMultiple(count: number = 9): Promise<ChooseImageResult> {
    const n = Math.min(9, Math.max(1, count));
    return pickWechatImagePaths(n).then((r) => {
        if (!r.ok) {
            return { ok: false, errMsg: r.errMsg || '选择失败' };
        }
        return {
            ok: true,
            tempFilePath: r.paths[0],
            tempFilePaths: r.paths,
        };
    });
}

export interface ChooseImagesResult {
    ok: boolean;
    urls: string[];
    revokeAll?: () => void;
    errMsg?: string;
}

/**
 * 从相册一次选择多张图片，最多 maxCount 张（默认最多 5）
 * - 微信：wx.chooseImage（优先） / wx.chooseMedia
 * - （已注释）浏览器：input[type=file][multiple]，仅 Web 预览用；微信小游戏发布不打包
 */
export function chooseImagesUpTo(maxCount: number = 5): Promise<ChooseImagesResult> {
    const n = Math.min(5, Math.max(1, maxCount));
    if (isWeChatMiniGame()) {
        return pickWechatImagePaths(n).then((r) => {
            if (!r.ok) {
                return { ok: false, urls: [], errMsg: r.errMsg };
            }
            return { ok: true, urls: r.paths.slice(0, n) };
        });
    }
    /* 微信小游戏发布：下列分支不会执行，保留便于本地浏览器预览时恢复
    if (typeof document !== 'undefined') {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = true;
            input.onchange = () => {
                const files = Array.from(input.files || []).slice(0, n);
                if (files.length === 0) {
                    resolve({ ok: false, urls: [], errMsg: '未选择文件' });
                    return;
                }
                const urls = files.map((f) => URL.createObjectURL(f));
                const revokeAll = () => urls.forEach((u) => URL.revokeObjectURL(u));
                resolve({ ok: true, urls, revokeAll });
            };
            input.click();
        });
    }
    */
    return Promise.resolve({ ok: false, urls: [], errMsg: '当前环境不支持选图' });
}
