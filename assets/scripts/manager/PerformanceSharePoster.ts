import { assetManager, type ImageAsset } from 'cc';
import { ImageExportError } from './PerformanceImageExport';
import type { ShareCodeEnvironment } from './PerformanceCloudService';

export type SharePosterColor = 'cream' | 'peach' | 'sage' | 'night';
export type SharePosterArt = 'cover' | 'garden';
export interface SharePosterStyle { color: SharePosterColor; art: SharePosterArt }
export const DEFAULT_SHARE_POSTER_STYLE: SharePosterStyle = { color: 'cream', art: 'cover' };
export const SHARE_POSTER_COLORS: ReadonlyArray<{ id: SharePosterColor; name: string; background: string; ink: string; muted: string }> = [
    { id: 'cream', name: '奶油白', background: '#FFF8EB', ink: '#533626', muted: '#967357' },
    { id: 'peach', name: '蜜桃粉', background: '#FFE8DD', ink: '#6F3C37', muted: '#AC7162' },
    { id: 'sage', name: '鼠尾草绿', background: '#EAF0DA', ink: '#344B34', muted: '#71856B' },
    { id: 'night', name: '暮夜蓝', background: '#243444', ink: '#FFF5DE', muted: '#BCD0D1' },
];
export const SHARE_POSTER_ART: ReadonlyArray<{ id: SharePosterArt; name: string; uuid: string; path: string }> = [
    { id: 'cover', name: '抱琴插画', uuid: 'a130590c-718f-42f1-85d2-d7f5d034e92b', path: 'assets/main/native/a1/a130590c-718f-42f1-85d2-d7f5d034e92b.png' },
    { id: 'garden', name: '花园木琴', uuid: '5789eb84-7e4d-49de-abce-0b201e1d18db', path: 'assets/main/native/57/5789eb84-7e4d-49de-abce-0b201e1d18db.png' },
];

/** 复用包内插画，不增加海报图片资源，也不上传用户内容。 */
export function loadSharePosterArt(art: SharePosterArt): Promise<{ image: CanvasImageSource; dispose(): void }> {
    const source = SHARE_POSTER_ART.find(value => value.id === art) ?? SHARE_POSTER_ART[0];
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true; reject(new ImageExportError('分享插画加载超时，请稍后重试'));
        }, 10000);
        try {
            // UUID 由 Cocos 解析，兼容带 MD5 的构建路径；借用已有资源时明确维护引用。
            assetManager.loadAny<ImageAsset>(source.uuid, (error, asset) => {
                if (done) return;
                done = true; clearTimeout(timer);
                if (error || !asset?.data || asset.width <= 0 || asset.height <= 0) {
                    reject(new ImageExportError('分享插画加载失败，请稍后重试')); return;
                }
                asset.addRef(); let released = false;
                resolve({ image: asset.data as CanvasImageSource, dispose: () => {
                    if (released) return; released = true; asset.decRef();
                } });
            });
        } catch { done = true; clearTimeout(timer); reject(new ImageExportError('分享插画加载失败，请稍后重试')); }
    });
}

/** 3:4 相册海报；小游戏码保留白底、完整比例和独立留白。 */
export function drawSharePoster(ctx: CanvasRenderingContext2D, art: CanvasImageSource, code: CanvasImageSource,
    songTitle: string, message: string, style: SharePosterStyle, environment: ShareCodeEnvironment = 'release'): void {
    const palette = SHARE_POSTER_COLORS.find(value => value.id === style.color) ?? SHARE_POSTER_COLORS[0];
    ctx.fillStyle = palette.background; ctx.fillRect(0, 0, 900, 1200);
    // 两款插画均使用原图完整比例，避免截断琴键或游戏标题。
    const heroHeight = style.art === 'garden' ? 900 * 384 / 688 : 600;
    ctx.drawImage(art, 0, 0, 900, heroHeight);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (style.art === 'garden') {
        ctx.fillStyle = palette.muted; ctx.font = '26px sans-serif';
        ctx.fillText('拇指琴演奏家', 70, 557);
    }
    const characters = Array.from(message.trim()).slice(0, 20);
    const lines = characters.length > 12 ? [characters.slice(0, 12).join(''), characters.slice(12).join('')] : [characters.join('')];
    ctx.fillStyle = palette.ink; ctx.font = 'bold 50px sans-serif';
    lines.forEach((line, index) => ctx.fillText(line, 70, 668 + index * 60, 760));
    ctx.fillStyle = palette.muted; ctx.font = '32px sans-serif';
    ctx.fillText(songTitle, 70, lines.length > 1 ? 798 : 746, 760);
    ctx.globalAlpha = 0.25; ctx.fillRect(70, 846, 760, 2); ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(70, 890, 244, 244);
    ctx.drawImage(code, 82, 902, 220, 220);
    ctx.fillStyle = palette.ink; ctx.font = 'bold 32px sans-serif';
    ctx.fillText('微信扫码听演奏', 355, 973, 470);
    ctx.fillStyle = palette.muted; ctx.font = '23px sans-serif';
    ctx.fillText('演奏保留90天', 355, 1023, 470);
    if (environment !== 'release') {
        ctx.font = '20px sans-serif';
        ctx.fillText(`${environment === 'develop' ? '开发版' : '体验版'}测试码 · 需有测试权限`, 355, 1066, 470);
    }
}
