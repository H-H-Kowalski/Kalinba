/**
 * 本地图片选择工具
 * 通过微信小游戏 API 实现从相册选择图片或拍照，供 Cocos 使用。
 * 文档：https://developers.weixin.qq.com/minigame/dev/api/media/image/wx.chooseImage.html
 *
 * Cocos 中显示选中的图片：
 * - 微信小游戏发布后，success 返回的 tempFilePath 为本地临时路径。
 * - 可用 assetManager.loadRemote(tempFilePath, (err, texture) => { ... }) 加载为 Texture2D，
 *   再通过 SpriteFrame.createWithTexture(texture) 显示。
 * - 若引擎或插件提供「从本地路径创建纹理」的接口，也可直接使用 tempFilePath。
 */

/** 微信小游戏环境下的 wx 类型（仅类型声明，运行时有全局 wx） */
declare const wx: {
    chooseImage: (options: {
        count?: number;
        sizeType?: string[];
        sourceType?: ('album' | 'camera')[];
        success?: (res: { tempFilePaths: string[]; tempFiles?: Array<{ path: string; size: number }> }) => void;
        fail?: (err: unknown) => void;
    }) => void;
    createImage?: () => {
        src: string;
        onload?: () => void;
        onerror?: (e: unknown) => void;
        width: number;
        height: number;
    };
} | undefined;

export interface ChooseImageResult {
    /** 是否成功 */
    ok: boolean;
    /** 临时文件路径（微信小游戏），选一张时取 [0] */
    tempFilePath?: string;
    /** 多张时的路径列表 */
    tempFilePaths?: string[];
    /** 错误信息 */
    errMsg?: string;
}

/**
 * 是否运行在微信小游戏环境
 */
export function isWeChatMiniGame(): boolean {
    return typeof wx !== 'undefined' && typeof wx.chooseImage === 'function';
}

/**
 * 打开相册/相机选择一张本地图片（仅微信小游戏）
 * @param sourceType 'album' 仅相册 | 'camera' 仅拍照 | 不传则都可用
 * @returns Promise<ChooseImageResult> 成功时 tempFilePath 为临时路径，可用于后续加载纹理
 */
export function chooseImage(sourceType?: 'album' | 'camera'): Promise<ChooseImageResult> {
    return new Promise((resolve) => {
        if (!isWeChatMiniGame()) {
            resolve({
                ok: false,
                errMsg: '当前不是微信小游戏环境，无法使用 wx.chooseImage',
            });
            return;
        }

        wx!.chooseImage({
            count: 1,
            sizeType: ['original', 'compressed'],
            sourceType: sourceType ? [sourceType] : ['album', 'camera'],
            success(res) {
                const path = res.tempFilePaths && res.tempFilePaths[0];
                resolve({
                    ok: !!path,
                    tempFilePath: path,
                    tempFilePaths: res.tempFilePaths,
                });
            },
            fail(err) {
                resolve({
                    ok: false,
                    errMsg: err ? String(err) : '用户取消或选择失败',
                });
            },
        });
    });
}

/**
 * 选择多张图片（最多 9 张）
 */
export function chooseImageMultiple(count: number = 9): Promise<ChooseImageResult> {
    return new Promise((resolve) => {
        if (!isWeChatMiniGame()) {
            resolve({ ok: false, errMsg: '仅支持微信小游戏环境' });
            return;
        }
        const n = Math.min(9, Math.max(1, count));
        wx!.chooseImage({
            count: n,
            sizeType: ['original', 'compressed'],
            sourceType: ['album', 'camera'],
            success(res) {
                resolve({
                    ok: true,
                    tempFilePath: res.tempFilePaths[0],
                    tempFilePaths: res.tempFilePaths,
                });
            },
            fail(err) {
                resolve({
                    ok: false,
                    errMsg: err ? String(err) : '选择失败',
                });
            },
        });
    });
}

/** 一次选择多张本地图片（用于谱子轮播等） */
export interface ChooseImagesResult {
    ok: boolean;
    /** 可传给 assetManager.loadRemote 的路径（微信临时路径 / Web blob URL） */
    urls: string[];
    /** Web 下需在选择新一批图或不再使用时调用，释放 blob URL */
    revokeAll?: () => void;
    errMsg?: string;
}

/**
 * 从相册一次选择多张图片，最多 maxCount 张（默认最多 5）
 * - 微信小游戏：wx.chooseImage
 * - 浏览器：input[type=file][multiple]
 */
export function chooseImagesUpTo(maxCount: number = 5): Promise<ChooseImagesResult> {
    const n = Math.min(5, Math.max(1, maxCount));
    if (isWeChatMiniGame()) {
        return new Promise((resolve) => {
            wx!.chooseImage({
                count: n,
                sizeType: ['original', 'compressed'],
                sourceType: ['album', 'camera'],
                success(res) {
                    const paths = res.tempFilePaths || [];
                    resolve({
                        ok: paths.length > 0,
                        urls: paths.slice(0, n),
                    });
                },
                fail(err) {
                    resolve({
                        ok: false,
                        urls: [],
                        errMsg: err ? String(err) : '选择失败',
                    });
                },
            });
        });
    }
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
    return Promise.resolve({ ok: false, urls: [], errMsg: '当前环境不支持选图' });
}
