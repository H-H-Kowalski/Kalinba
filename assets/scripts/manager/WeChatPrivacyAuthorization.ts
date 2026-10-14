import { getWx } from './WeChatNative';
import { showPrivacyConsentDialog } from '../view/PrivacyConsentDialog';

type ResolvePrivacy = (result: { event: 'exposureAuthorization' | 'agree' | 'disagree' }) => void;
type PrivacyApi = {
    onNeedPrivacyAuthorization?: (listener: (resolve: ResolvePrivacy) => void) => void;
    requirePrivacyAuthorize?: (options: { success: () => void; fail: (error: unknown) => void }) => void;
    getPrivacySetting?: (options: {
        success: (result: { privacyContractName?: string }) => void;
        fail: (error: unknown) => void;
    }) => void;
};
type Request = { receive: (resolve: ResolvePrivacy) => void };
let registeredApi: PrivacyApi | undefined;
let active: Request | undefined;

/** 只在用户发起选图或保存图片后请求授权；取消时不能遗留可点击的授权弹窗。 */
export function requestImagePrivacyAuthorization(success: () => void, fail: (error: unknown) => void,
    purpose: 'choose' | 'save' = 'choose'): () => void {
    const api = getWx() as PrivacyApi | undefined;
    if (!api?.requirePrivacyAuthorize) {
        success(); // 老基础库由选图接口执行平台权限检查。
        return () => {};
    }
    if (active) {
        fail(new Error('隐私授权正在处理中'));
        return () => {};
    }
    let finished = false;
    let opening = false;
    let exposed = false;
    let agreed = false;
    let closeDialog: (() => void) | undefined;
    let settingsTimer: ReturnType<typeof setTimeout> | undefined;
    const resolvers = new Set<ResolvePrivacy>();
    const report = (event: 'exposureAuthorization' | 'agree' | 'disagree') => {
        for (const resolve of Array.from(resolvers)) {
            try { resolve({ event }); }
            catch { console.warn('[Privacy:v2] authorization callback failed'); }
        }
    };
    const finish = (allowed: boolean, error?: unknown) => {
        if (finished) return;
        finished = true;
        if (settingsTimer !== undefined) clearTimeout(settingsTimer);
        if (active === request) active = undefined;
        closeDialog?.();
        if (!allowed && !agreed) report('disagree');
        resolvers.clear();
        if (allowed) success();
        else {
            const code = (error as { errno?: unknown; errCode?: unknown } | undefined)?.errno
                ?? (error as { errCode?: unknown } | undefined)?.errCode;
            console.warn('[Privacy:v2] authorization incomplete', { errorCode: typeof code === 'number' ? code : undefined });
            fail(error || new Error('隐私授权未完成'));
        }
    };
    const request: Request = { receive: resolve => {
        if (finished || agreed) {
            try { resolve({ event: 'disagree' }); } catch { /* Fail closed. */ }
            return;
        }
        resolvers.add(resolve);
        if (exposed) {
            try { resolve({ event: 'exposureAuthorization' }); } catch { finish(false); }
            return;
        }
        if (opening) return;
        opening = true;
        // 从平台取正式的指引名称；未配置或读取失败不能伪造一份政策让用户同意。
        settingsTimer = setTimeout(() => finish(false, new Error('隐私指引读取超时')), 10000);
        try {
            if (!api.getPrivacySetting) return finish(false);
            api.getPrivacySetting({
                fail: error => finish(false, error),
                success: result => {
                    if (finished || closeDialog) return;
                    clearTimeout(settingsTimer);
                    const name = result?.privacyContractName;
                    if (typeof name !== 'string' || !name.trim()) return finish(false);
                    try {
                        closeDialog = showPrivacyConsentDialog(name, {
                            exposed: () => {
                                if (finished || exposed) return;
                                exposed = true;
                                console.log('[Privacy:v2] custom dialog displayed');
                                report('exposureAuthorization');
                            },
                            agree: () => {
                                if (finished || !exposed || agreed) return;
                                agreed = true;
                                closeDialog?.();
                                report('agree');
                                // 只能等待微信 requirePrivacyAuthorize 的 success，不能自行打开相册。
                            },
                            disagree: () => finish(false, new Error('用户未同意隐私授权')),
                        }, purpose);
                        if (finished) closeDialog();
                    } catch (error) { finish(false, error); }
                },
            });
        } catch (error) { finish(false, error); }
    } };
    active = request;
    try {
        if (api.onNeedPrivacyAuthorization && registeredApi !== api) {
            api.onNeedPrivacyAuthorization(resolve => {
                if (typeof resolve !== 'function') return;
                if (active) active.receive(resolve);
                else { try { resolve({ event: 'disagree' }); } catch { /* No active user request. */ } }
            });
            registeredApi = api;
        }
        console.log('[Privacy:v2] requesting', { customDialog: registeredApi === api });
        api.requirePrivacyAuthorize({ success: () => finish(true), fail: error => finish(false, error) });
    } catch (error) { finish(false, error); }
    return () => finish(false, new Error('隐私授权已取消'));
}
