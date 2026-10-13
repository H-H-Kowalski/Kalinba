import { getWx } from './WeChatNative';

type ShareOptions = { title: string; query: string; imageUrl: string; imagePreviewUrl?: string };
type ShareMenuApi = {
    canIUse?: (feature: string) => boolean;
    getAppBaseInfo?: () => { SDKVersion?: string };
    getSystemInfoSync?: () => { SDKVersion?: string };
    onShareAppMessage?: (listener: () => ShareOptions) => void;
    onShareTimeline?: (listener: () => ShareOptions) => void;
    offShareAppMessage?: (listener: () => ShareOptions) => void;
    offShareTimeline?: (listener: () => ShareOptions) => void;
    showShareMenu?: (options: { menus: string[]; fail?: () => void }) => void;
    showModal?: (options: { title: string; content: string; showCancel: boolean; confirmText: string }) => void;
};

// Reuse the built-in friend-playback artwork. Release checks verify this path.
const DEFAULT_IMAGE = 'assets/main/native/57/5789eb84-7e4d-49de-abce-0b201e1d18db.png';
let registeredApi: ShareMenuApi | undefined;
let timelineAvailable = false;
let prepared: ShareOptions | null = null;

function supportsExplicitPreview(api: ShareMenuApi): boolean {
    // imagePreviewUrl was added in 2.14.3; older clients may take a draft screenshot.
    for (const read of [api.getAppBaseInfo, api.getSystemInfoSync]) {
        if (!read) continue;
        try {
            const version = read.call(api)?.SDKVersion;
            const parts = typeof version === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(version) : null;
            if (!parts) continue;
            const major = Number(parts[1]), minor = Number(parts[2]), patch = Number(parts[3]);
            return major > 2 || (major === 2 && (minor > 14 || (minor === 14 && patch >= 3)));
        } catch { /* Try the older system-info API. */ }
    }
    return false;
}

/** Synchronous callbacks only expose an approved, uploaded snapshot, never input drafts. */
function friendOptions(): ShareOptions {
    return prepared ? { title: prepared.title, query: prepared.query, imageUrl: prepared.imageUrl }
        : { title: '拇指琴演奏家', query: '', imageUrl: DEFAULT_IMAGE };
}

function timelineOptions(): ShareOptions {
    const options = friendOptions();
    // Explicit preview also prevents WeChat taking a screenshot of a pending input.
    return { ...options, imagePreviewUrl: options.imageUrl };
}

function showMenu(api: ShareMenuApi): void {
    if (!api.showShareMenu) return;
    const fallback = () => {
        if (registeredApi !== api) return;
        timelineAvailable = false;
        console.warn('[ShareMenu:v1] timeline menu unavailable');
        try { api.showShareMenu?.({ menus: ['shareAppMessage'] }); } catch { /* Manual friend sharing still works. */ }
    };
    try {
        api.showShareMenu({ menus: timelineAvailable ? ['shareAppMessage', 'shareTimeline'] : ['shareAppMessage'],
            fail: timelineAvailable ? fallback : undefined });
    } catch { if (timelineAvailable) fallback(); }
}

/** Global handlers contain no scene references and survive settings/home round trips. */
export function installPerformanceShareMenu(): void {
    const api = getWx() as ShareMenuApi | undefined;
    if (!api || registeredApi === api) return;
    if (registeredApi) {
        try { registeredApi.offShareAppMessage?.(friendOptions); } catch { /* Best effort. */ }
        try { registeredApi.offShareTimeline?.(timelineOptions); } catch { /* Best effort. */ }
    }
    registeredApi = api;
    prepared = null;
    timelineAvailable = false;
    try { api.onShareAppMessage?.(friendOptions); } catch { /* Manual friend sharing still works. */ }
    try {
        if (api.showShareMenu && api.onShareTimeline && supportsExplicitPreview(api) &&
            (!api.canIUse || api.canIUse('onShareTimeline'))) {
            api.onShareTimeline(timelineOptions);
            timelineAvailable = true;
        }
    } catch { /* Unsupported clients keep friend sharing. */ }
    showMenu(api);
}

export function isTimelineShareAvailable(): boolean {
    installPerformanceShareMenu();
    return timelineAvailable;
}

/** Called only after text review, safe card generation and cloud save all succeeded. */
export function setPreparedPerformanceShare(value: { title: string; recordId: string; imageUrl: string }): void {
    installPerformanceShareMenu();
    if (!value.title || !value.recordId || !value.imageUrl) throw new Error('分享内容未准备完成');
    prepared = { title: value.title, query: `rid=${encodeURIComponent(value.recordId)}`, imageUrl: value.imageUrl };
}

export function clearPreparedPerformanceShare(): void {
    prepared = null;
}

/** A validated cloud read can be forwarded without creating another recording. */
export function setReceivedPerformanceShare(recordId: string): void {
    setPreparedPerformanceShare({ title: '送你一首歌', recordId, imageUrl: DEFAULT_IMAGE });
}

/** WeChat provides timeline sharing through its top-right menu, not a direct launch API. */
export function showTimelineShareGuide(): boolean {
    if (!isTimelineShareAvailable()) return false;
    try {
        registeredApi?.showModal?.({ title: '分享到朋友圈',
            content: '歌曲已准备好。点击右上角「…」，选择「分享到朋友圈」。',
            showCancel: false, confirmText: '知道了' });
    } catch { /* Caller also shows a lightweight menu hint. */ }
    return true;
}
