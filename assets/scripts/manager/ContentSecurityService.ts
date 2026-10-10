import { getWx } from './WeChatNative';
import { callWxCloudFunction } from './WeChatCloudFunction';

type Verdict = { status?: 'pass' | 'reject' | 'unavailable'; errorCode?: number };
type ImageUpload = { status?: string; cloudPath?: string; env?: string };
export class ContentSecurityError extends Error {
    constructor(public readonly rejected = false, public readonly stage?: string,
        public readonly reason?: string, public readonly errorCode?: number) {
        super(rejected ? '内容不符合规范，请修改后重试' : '暂时不可替换，请稍后重试');
        this.name = 'ContentSecurityError';
    }
}

export class ContentSecurityService {
    private static imageRequest = 0;

    private static imageError(stage: string, reason: string, error?: unknown): ContentSecurityError {
        const value = error as { errCode?: unknown; errno?: unknown; errorCode?: unknown } | undefined;
        const code = value?.errCode ?? value?.errno ?? value?.errorCode;
        return new ContentSecurityError(false, stage, reason,
            typeof code === 'number' && Number.isFinite(code) ? code : undefined);
    }

    private static async check(data: Record<string, unknown>): Promise<void> {
        let result: Verdict;
        try { result = await callWxCloudFunction<Verdict>('checkContentSecurity', data); }
        catch { throw new ContentSecurityError(); }
        if (result?.status !== 'pass') {
            // 只记录状态和错误码，真机定位权限/额度问题时不泄露文案、图片或临时 URL。
            console.warn('[ContentSecurity] blocked', {
                kind: data.kind,
                status: result?.status === 'reject' ? 'reject' : 'unavailable',
                errorCode: typeof result?.errorCode === 'number' ? result.errorCode : undefined,
            });
            throw new ContentSecurityError(result?.status === 'reject', undefined, 'review_result',
                typeof result?.errorCode === 'number' ? result.errorCode : undefined);
        }
    }

    static async requireText(content: string): Promise<void> {
        if (typeof content !== 'string' || content.length > 200) throw new ContentSecurityError();
        if (!content.trim()) return;
        await this.check({ kind: 'text', content });
    }

    static async requireImages(paths: string[], onProgress?: (current: number, total: number) => void): Promise<void> {
        if (!Array.isArray(paths) || !paths.length || paths.length > 5 ||
            paths.some(path => typeof path !== 'string' || !path.trim())) throw new ContentSecurityError();
        const request = ++this.imageRequest;
        let stage = 'file', index = 0;
        const progress = (next: string) => {
            stage = next;
            console.log('[ImageSecurity:v2] stage', { request, index: index + 1, count: paths.length, stage });
        };
        try {
            // Sequential requests avoid bursts; commit only after ALL original images pass.
            for (; index < paths.length; index++) {
                onProgress?.(index + 1, paths.length);
                progress('file');
                const extension = await this.readImage(paths[index]);
                progress('prepare_upload');
                let upload: ImageUpload;
                try { upload = await callWxCloudFunction<ImageUpload>('checkContentSecurity', { kind: 'prepareImage', extension }); }
                catch (error) { throw this.imageError(stage, 'cloud_call', error); }
                if (upload?.status !== 'ready' || typeof upload.env !== 'string' || !upload.env ||
                    typeof upload.cloudPath !== 'string' ||
                    !/^content-security\/[a-f0-9]{64}\/[a-f0-9]{48}\.(jpg|jpeg|png|bmp|tif|tiff|webp|gif)$/.test(upload.cloudPath)) {
                    throw this.imageError(stage, 'invalid_response');
                }
                progress('upload');
                const fileID = await this.uploadImage(paths[index], upload.cloudPath, upload.env);
                try { progress('review'); await this.check({ kind: 'image', fileID }); }
                finally { this.removeTemporaryFile(fileID, upload.env); }
            }
            console.log('[ImageSecurity:v2] approved', { request, count: paths.length });
        } catch (error) {
            const detail = error instanceof ContentSecurityError ? error : this.imageError(stage, 'unexpected');
            // No local paths, file IDs, image bytes, signed URLs or raw platform error strings.
            console.warn('[ImageSecurity:v2] failed', { request, index: index + 1, stage: detail.stage || stage,
                reason: detail.reason || 'unavailable', errorCode: detail.errorCode, rejected: detail.rejected });
            throw detail;
        }
    }

    private static removeTemporaryFile(fileID: string, env: string): void {
        // Server cleanup is primary; this also handles a lost function response or a late upload.
        try {
            const returned = (getWx() as any)?.cloud?.deleteFile?.({
                fileList: [fileID], config: { env }, success: () => {}, fail: () => {},
            });
            if (returned?.then) Promise.resolve(returned).catch(() => {});
        } catch { /* Best effort: storage lifecycle cleanup is the final backstop. */ }
    }

    private static uploadImage(path: string, cloudPath: string, env: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let settled = false;
            let acceptedID = '';
            const expected = (value: unknown): value is string => typeof value === 'string' &&
                value.startsWith(`cloud://${env}.`) && value.slice(value.indexOf('/', 8) + 1) === cloudPath;
            const timer = setTimeout(() => fail('timeout'), 20000);
            const fail = (reason: string, error?: unknown) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(this.imageError('upload', reason, error));
            };
            const success = (result: any) => {
                const fileID = result?.fileID;
                if (settled) {
                    if (!acceptedID && expected(fileID)) this.removeTemporaryFile(fileID, env);
                    return;
                }
                if (!expected(fileID)) return fail('invalid_file_id');
                acceptedID = fileID;
                settled = true;
                clearTimeout(timer);
                resolve(fileID);
            };
            try {
                const cloud = (getWx() as any)?.cloud;
                if (!cloud?.uploadFile) return fail('api_unavailable');
                const onError = (error: unknown) => fail('api_error', error);
                const returned = cloud.uploadFile({ cloudPath, filePath: path, config: { env }, success, fail: onError });
                if (returned?.then) Promise.resolve(returned).then(success, onError);
            } catch (error) { fail('api_error', error); }
        });
    }

    private static readImage(path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const wxApi = getWx() as any;
            let settled = false;
            let stage = 'file_size';
            const timer = setTimeout(() => fail('timeout'), 10000);
            const fail = (reason: string, error?: unknown) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(this.imageError(stage, reason, error));
            };
            try {
                if (!wxApi?.getFileSystemManager || typeof path !== 'string' || !path.trim()) return fail('api_unavailable');
                const fs = wxApi.getFileSystemManager();
                if (!fs?.getFileInfo || !fs?.readFile) return fail('api_unavailable');
                const onError = (error: unknown) => fail('api_error', error);
                // 小游戏不能依赖小程序的 getImageInfo。读取原始文件大小和最多 12 字节文件头；
                // 不信任路径后缀，不解码/展示未审核图片，也不将整图转成 base64。
                fs.getFileInfo({ filePath: path, fail: onError, success: (file: any) => {
                    if (settled || stage !== 'file_size') return;
                    if (!file || !Number.isSafeInteger(file.size) || file.size <= 0) return fail('invalid_size');
                    if (file.size > 10 * 1000 * 1000) return fail('size_limit');
                    stage = 'file_header';
                    try { fs.readFile({ filePath: path, position: 0, length: Math.min(12, file.size), fail: onError, success: (result: any) => {
                        if (settled) return;
                        try {
                            const extension = this.imageExtension(result?.data);
                            if (!extension) return fail('unsupported_format');
                            settled = true;
                            clearTimeout(timer);
                            resolve(extension);
                        } catch (error) { fail('invalid_header', error); }
                    } }); } catch (error) { onError(error); }
                } });
            } catch (error) { fail('api_error', error); }
        });
    }

    private static imageExtension(data: unknown): string | null {
        let bytes: Uint8Array;
        if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, Math.min(12, data.byteLength));
        else if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') bytes = new Uint8Array(data as ArrayBuffer).subarray(0, 12);
        else return null;
        const starts = (prefix: number[], offset = 0) => prefix.every((value, i) => bytes[offset + i] === value);
        if (starts([137,80,78,71,13,10,26,10])) return 'png';
        if (starts([255,216,255])) return 'jpg';
        if (starts([71,73,70,56,55,97]) || starts([71,73,70,56,57,97])) return 'gif';
        if (starts([66,77])) return 'bmp';
        if (starts([82,73,70,70]) && starts([87,69,66,80], 8)) return 'webp';
        if (starts([73,73,42,0]) || starts([77,77,0,42])) return 'tiff';
        return null;
    }

    static message(error: unknown): string {
        return error instanceof ContentSecurityError ? error.message : '暂时不可替换，请稍后重试';
    }
}
