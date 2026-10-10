import { sys } from 'cc';
import { getWx } from './WeChatNative';
import { ChallengeLaunchStore } from './ChallengeLaunchStore';
import { WECHAT_CLOUD_ENV } from './WeChatCloudFunction';

const KEY = 'kalinba_pending_share_record_id_v1';
const ACHIEVEMENT_KEY = 'kalinba_pending_achievement_open_v1';
let installed = false;
let pendingRecordId = '';
const gameLaunchListeners = new Set<() => void>();

function savePendingRecordId(recordId: string): void {
    if (!recordId) return;
    pendingRecordId = recordId;
}

function parseQueryFromOptions(options: unknown): void {
    const query = (options as { query?: Record<string, unknown> } | undefined)?.query;
    const rid = typeof query?.rid === 'string' ? query.rid : '';
    let shouldEnterGame = false;
    if (rid) {
        // 好友录音优先，避免它结束后再自动跳入历史遗留挑战。
        ChallengeLaunchStore.take();
        savePendingRecordId(rid);
        shouldEnterGame = true;
    }
    const challenge = typeof query?.challenge === 'string' ? query.challenge : '';
    if (!rid && /^c[1-3]-0[1-3]$/.test(challenge)) {
        pendingRecordId = '';
        ChallengeLaunchStore.request(challenge);
        shouldEnterGame = true;
    }
    if (query?.achievement === '1') {
        try {
            sys.localStorage.setItem(ACHIEVEMENT_KEY, '1');
        } catch {
            // ignore
        }
    }
    if (shouldEnterGame) {
        console.log('[ShareLaunch] captured game entry', { hasRecord: !!rid, challenge });
        // 与微信发布编译兼容；快照也避免监听器在回调中增删影响本轮通知。
        for (const listener of Array.from(gameLaunchListeners)) {
            try {
                listener();
            } catch {
                // 单个页面监听失败不影响启动参数保存。
            }
        }
    }
}

export function installShareLaunchCapture(): void {
    if (installed) return;
    const wxApi = getWx() as {
        cloud?: {
            init?: (arg?: { env?: string; traceUser?: boolean }) => void;
        };
        getLaunchOptionsSync?: () => unknown;
        getEnterOptionsSync?: () => unknown;
        onShow?: (cb: (opt: unknown) => void) => void;
    } | undefined;
    if (!wxApi) return;
    installed = true;
    // 未消费的旧分享参数不能留到下一次普通启动。
    try { sys.localStorage.removeItem(KEY); } catch { /* Memory-only routing still works. */ }
    try {
        wxApi.cloud?.init?.({ env: WECHAT_CLOUD_ENV, traceUser: true });
    } catch (error) {
        console.error('[ShareLaunch:v2] cloud init failed', error);
    }
    try {
        const enter = wxApi.getEnterOptionsSync?.() as { query?: Record<string, unknown> } | undefined;
        const query = enter?.query;
        // 只分发一次；最新进入参数优先于最初启动参数。
        parseQueryFromOptions(query?.rid || query?.challenge || query?.achievement
            ? enter : wxApi.getLaunchOptionsSync?.());
    } catch {
        // ignore
    }
    try {
        wxApi.onShow?.((opt) => parseQueryFromOptions(opt));
    } catch {
        // ignore
    }
}

export function takePendingSharedRecordId(): string {
    const rid = pendingRecordId;
    pendingRecordId = '';
    return rid;
}

export function hasPendingSharedRecordId(): boolean {
    return !!pendingRecordId;
}

/** 冷启动和小游戏已在后台两种情况都能收到分享进入通知。 */
export function onPendingGameLaunch(listener: () => void): () => void {
    gameLaunchListeners.add(listener);
    return () => gameLaunchListeners.delete(listener);
}

export function takePendingAchievementLaunch(): boolean {
    try {
        const pending = sys.localStorage.getItem(ACHIEVEMENT_KEY) === '1';
        if (pending) sys.localStorage.removeItem(ACHIEVEMENT_KEY);
        return pending;
    } catch {
        return false;
    }
}
