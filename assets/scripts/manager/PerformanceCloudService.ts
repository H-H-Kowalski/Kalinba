import { PERFORMANCE_MAX_DURATION_MS, PERFORMANCE_MAX_ENCODED_SIZE, PERFORMANCE_MAX_EVENTS, PerformanceSharePayload, type PerformanceRecord } from './PerformanceTypes';
import { PerformanceRecorder } from './PerformanceRecorder';
import { callWxCloudFunction } from './WeChatCloudFunction';
import { ContentSecurityError } from './ContentSecurityService';
import { getWx } from './WeChatNative';

export type ShareCodeEnvironment = 'release' | 'trial' | 'develop';

/** 环境来自当前小游戏账号信息，不能把开发/体验版图片默认为已发布客户端。 */
export function getPerformanceShareEnvironment(): ShareCodeEnvironment {
    const api = getWx() as { getAccountInfoSync?: () => { miniProgram?: { envVersion?: unknown } } } | undefined;
    let value: unknown;
    try { value = api?.getAccountInfoSync?.().miniProgram?.envVersion; } catch { /* Fail closed below. */ }
    if (value === 'release' || value === 'trial' || value === 'develop') return value;
    throw new Error('无法确认小游戏版本，暂时不能生成扫码图片');
}

type CreateResult = PerformanceSharePayload & { securityStatus?: string; contentSecurityVersion?: number };

type GetResult = {
    record: PerformanceRecord;
    contentSecurityVersion?: number;
};

export class PerformanceCloudService {
    static async getShareCode(recordId: string, envVersion: ShareCodeEnvironment = 'release'): Promise<string> {
        if (!['release', 'trial', 'develop'].includes(envVersion)) throw new Error('小游戏版本无效');
        if (!/^[a-zA-Z0-9_-]{1,28}$/.test(recordId)) throw new Error('演奏编号无效');
        const result = await callWxCloudFunction<{ recordId?: string; imageBase64?: string; codeVersion?: number; envVersion?: string }>(
            'getPerformanceShareCode', { recordId, envVersion });
        const image = result?.imageBase64;
        if (result?.recordId !== recordId || result?.codeVersion !== 2 || result?.envVersion !== envVersion || typeof image !== 'string' ||
            image.length > 350000 || !/^(iVBORw0KGgo|\/9j\/)[A-Za-z0-9+/]*={0,2}$/.test(image)) {
            throw new Error('小游戏码生成失败，请稍后重试');
        }
        return image;
    }

    static async createRecord(record: PerformanceRecord): Promise<string> {
        const err = PerformanceRecorder.validate(record);
        if (err) throw new Error(err);
        if (record.durationMs > PERFORMANCE_MAX_DURATION_MS) throw new Error('duration out of range');
        if (record.events.length > PERFORMANCE_MAX_EVENTS) throw new Error('event count exceeds limit');

        const encoded = PerformanceRecorder.encode(record);
        if (encoded.length > PERFORMANCE_MAX_ENCODED_SIZE) {
            throw new Error('encoded payload too large');
        }
        let result: CreateResult;
        try {
            result = await callWxCloudFunction<CreateResult>('createPerformanceRecord', {
                durationMs: record.durationMs,
                stylePreset: record.stylePreset,
                title: record.title ?? '',
                eventsEncoded: encoded,
                eventCount: record.events.length,
                appVersion: record.appVersion,
            });
        } catch { throw new ContentSecurityError(); }
        if (result?.securityStatus) throw new ContentSecurityError(result.securityStatus === 'reject');
        // Mixed deployments must not treat an old function's ID as proof of moderation.
        if (result?.contentSecurityVersion !== 1 || typeof result.recordId !== 'string' || !result.recordId.trim()) {
            throw new ContentSecurityError();
        }
        return result.recordId;
    }

    static async getRecord(recordId: string): Promise<PerformanceRecord> {
        if (!recordId) throw new Error('recordId is required');
        const result = await callWxCloudFunction<GetResult>('getPerformanceRecord', { recordId });
        if (!result?.record) throw new Error('record not found');
        const record = { ...result.record, title: result.contentSecurityVersion === 1 &&
            typeof result.record.title === 'string' && result.record.title.length <= 40
            ? result.record.title : '《分享演奏》' };
        const error = PerformanceRecorder.validate(record);
        if (error) throw new Error(`invalid shared record: ${error}`);
        return record;
    }
}
