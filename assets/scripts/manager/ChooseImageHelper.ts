/**
 * 本地图片选择（微信小游戏）
 *
 * 优先使用 wx.chooseMedia（基础库 ≥2.23，官方推荐替代维护减弱的 chooseImage）：
 * https://developers.weixin.qq.com/minigame/dev/api/media/video/wx.chooseMedia.html
 * 低版本回退：wx.chooseImage
 * https://developers.weixin.qq.com/minigame/dev/api/media/image/wx.chooseImage.html
 *
 * 选中后 tempFilePath 可交给 assetManager.loadRemote 等加载为纹理。
 */

import { getWx } from './WeChatNative';

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
 * 微信内选图：优先 chooseMedia，失败或未实现时回退 chooseImage
 */
function pickWechatImagePaths(
    count: number,
    sourceType?: 'album' | 'camera',
): Promise<{ ok: boolean; paths: string[]; errMsg?: string }> {
    return new Promise((resolve) => {
        const w = getWx() as {
            chooseMedia?: (o: WxChooseMediaOptions) => void;
            chooseImage?: (o: WxChooseImageOptions) => void;
        };
        if (!w) {
            resolve({ ok: false, paths: [], errMsg: 'wx 不可用' });
            return;
        }
        const st = normalizeSourceType(sourceType);
        const finishFail = (err: unknown) => {
            resolve({ ok: false, paths: [], errMsg: formatWxChooseErr(err) });
        };

        // 仅选图时优先 chooseImage：隐私与基础库上通常比 chooseMedia 更稳（避免 checkPrivacy apiName=chooseMedia type=undefined、errno 1026 等）
        if (typeof w.chooseImage === 'function') {
            w.chooseImage({
                count,
                sizeType: ['original', 'compressed'],
                sourceType: st,
                success(res) {
                    const paths = res.tempFilePaths || [];
                    resolve({ ok: paths.length > 0, paths });
                },
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
                    const paths = (res.tempFiles || [])
                        .map((f) => f.tempFilePath)
                        .filter((p): p is string => !!p);
                    resolve({ ok: paths.length > 0, paths });
                },
                fail: finishFail,
            });
            return;
        }

        resolve({ ok: false, paths: [], errMsg: '不支持选图 API' });
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
 * - 微信：wx.chooseMedia（优先） / wx.chooseImage
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
