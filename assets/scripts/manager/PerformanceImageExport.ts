import { getWx } from './WeChatNative';
import { requestImagePrivacyAuthorization } from './WeChatPrivacyAuthorization';

export class ImageExportError extends Error {
    constructor(message: string, public readonly cancelled = false) { super(message); }
}

/** 码图片只用于本次合成，写入、解码或超时失败都清理临时文件。 */
export function loadShareCodeImage(base64: string): Promise<{ image: CanvasImageSource; dispose(): void }> {
    const api = getWx() as any;
    if (!api?.getFileSystemManager || !api.createImage || !api.env?.USER_DATA_PATH) {
        return Promise.reject(new ImageExportError('当前微信暂不支持生成分享图片'));
    }
    return new Promise((resolve, reject) => {
        let done = false;
        let image: any;
        const fs = api.getFileSystemManager();
        const path = `${api.env.USER_DATA_PATH}/kalinba-code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const dispose = () => {
            if (image) { image.onload = null; image.onerror = null; }
            try { fs.unlink({ filePath: path, fail: () => {} }); } catch { /* Best-effort temp cleanup. */ }
        };
        const finish = (ok: boolean) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (ok) resolve({ image, dispose });
            else { dispose(); reject(new ImageExportError('小游戏码图片加载失败，请稍后重试')); }
        };
        const timer = setTimeout(() => finish(false), 10000);
        try {
            fs.writeFile({ filePath: path, data: base64, encoding: 'base64',
                fail: () => finish(false),
                success: () => {
                    if (done) { dispose(); return; }
                    try {
                        image = api.createImage();
                        image.onload = () => finish(image.width > 0 && image.height > 0);
                        image.onerror = () => finish(false);
                        image.src = path;
                    } catch { finish(false); }
                },
            });
        } catch { finish(false); }
    });
}

/** 必须先收到平台隐私授权，再保存；离开页面后不能继续打开相册或发成功提示。 */
export function saveShareImageToAlbum(filePath: string, isCurrent: () => boolean): { promise: Promise<void>; cancel(): void } {
    const api = getWx() as any;
    let cancel = () => {};
    const promise = new Promise<void>((resolve, reject) => {
        let done = false;
        let cancelPrivacy = () => {};
        const finish = (error?: ImageExportError) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            cancelPrivacy();
            if (error) reject(error); else resolve();
        };
        cancel = () => finish(new ImageExportError('已取消保存', true));
        const current = () => {
            if (done) return false;
            if (!isCurrent()) { cancel(); return false; }
            return true;
        };
        const timer = setTimeout(() => finish(new ImageExportError('保存图片超时，请检查相册后再重试')), 120000);
        if (!current()) return;
        if (!filePath || !api?.saveImageToPhotosAlbum) {
            finish(new ImageExportError('当前微信暂不支持保存图片，请在手机微信中使用'));
            return;
        }
        const failure = (error: unknown) => {
            if (!current()) return;
            const details = error as { errMsg?: string; message?: string; errno?: number; errCode?: number };
            const message = String(details?.errMsg ?? details?.message ?? '');
            // 隐私声明缺项与用户拒绝是不同层级；反复请求用户同意无法补齐后台声明。
            console.warn('[ShareImage:v1] album save failed', {
                errorCode: details?.errno ?? details?.errCode,
                message: message.slice(0, 300),
            });
            if (/not declared|privacy agreement|未声明|未.*配置.*隐私/i.test(message) || details?.errno === 112) {
                finish(new ImageExportError('保存图片功能暂未开放，请稍后重试'));
            } else if (/cancel/i.test(message)) finish(new ImageExportError('已取消保存', true));
            else if (/privacy/i.test(message)) finish(new ImageExportError('未完成隐私授权，暂时无法保存图片'));
            else if (/auth|denied|permission/i.test(message)) {
                finish(new ImageExportError('未获相册权限，请在微信设置中允许保存图片后重试'));
            } else finish(new ImageExportError('保存图片失败，请稍后重试'));
        };
        try {
            cancelPrivacy = requestImagePrivacyAuthorization(() => {
                if (!current()) return;
                try {
                    const returned = api.saveImageToPhotosAlbum({ filePath,
                        success: () => { if (current()) finish(); }, fail: failure });
                    if (returned?.then) Promise.resolve(returned).then(() => { if (current()) finish(); }, failure);
                } catch (error) { failure(error); }
            }, () => { if (current()) finish(new ImageExportError('未完成隐私授权，暂时无法保存图片')); }, 'save');
            if (done) cancelPrivacy();
        } catch (error) { failure(error); }
    });
    return { promise, cancel: () => cancel() };
}
