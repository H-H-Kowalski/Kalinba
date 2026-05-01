import { sys } from 'cc';
import { getWx } from './WeChatNative';

const KEY = 'kalinba_pending_share_record_id_v1';
let installed = false;

function savePendingRecordId(recordId: string): void {
    if (!recordId) return;
    try {
        sys.localStorage.setItem(KEY, recordId);
    } catch {
        // ignore
    }
}

function parseQueryFromOptions(options: unknown): void {
    const query = (options as { query?: Record<string, unknown> } | undefined)?.query;
    const rid = typeof query?.rid === 'string' ? query.rid : '';
    if (rid) {
        savePendingRecordId(rid);
    }
}

export function installShareLaunchCapture(): void {
    if (installed) return;
    installed = true;
    const wxApi = getWx() as {
        cloud?: {
            init?: (arg?: { env?: string; traceUser?: boolean }) => void;
        };
        getLaunchOptionsSync?: () => unknown;
        getEnterOptionsSync?: () => unknown;
        onShow?: (cb: (opt: unknown) => void) => void;
    } | undefined;
    if (!wxApi) return;
    try {
        wxApi.cloud?.init?.({ traceUser: true });
    } catch {
        // ignore
    }
    try {
        if (wxApi.getLaunchOptionsSync) parseQueryFromOptions(wxApi.getLaunchOptionsSync());
        if (wxApi.getEnterOptionsSync) parseQueryFromOptions(wxApi.getEnterOptionsSync());
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
    try {
        const rid = sys.localStorage.getItem(KEY) ?? '';
        if (rid) sys.localStorage.removeItem(KEY);
        return rid;
    } catch {
        return '';
    }
}
