import { getWx } from './WeChatNative';
import { PERFORMANCE_MAX_DURATION_MS, PERFORMANCE_MAX_ENCODED_SIZE, PERFORMANCE_MAX_EVENTS, PerformanceSharePayload, type PerformanceRecord } from './PerformanceTypes';
import { PerformanceRecorder } from './PerformanceRecorder';

type CallResult<T> = {
    result?: T;
};

type CreateResult = PerformanceSharePayload;

type GetResult = {
    record: PerformanceRecord;
};

function callWxCloudFunction<T>(name: string, data: Record<string, unknown>): Promise<T> {
    const wxApi = getWx() as {
        cloud?: {
            callFunction?: (arg: { name: string; data: Record<string, unknown> }) => Promise<CallResult<T>>;
        };
    } | undefined;
    if (!wxApi?.cloud?.callFunction) {
        return Promise.reject(new Error('wx.cloud.callFunction is unavailable'));
    }
    return wxApi.cloud.callFunction({ name, data }).then((res) => {
        if (!res?.result) throw new Error('empty cloud result');
        return res.result;
    });
}

export class PerformanceCloudService {
    static async createRecord(record: PerformanceRecord): Promise<string> {
        const err = PerformanceRecorder.validate(record);
        if (err) throw new Error(err);
        if (record.durationMs > PERFORMANCE_MAX_DURATION_MS) throw new Error('duration out of range');
        if (record.events.length > PERFORMANCE_MAX_EVENTS) throw new Error('event count exceeds limit');

        const encoded = PerformanceRecorder.encode(record);
        if (encoded.length > PERFORMANCE_MAX_ENCODED_SIZE) {
            throw new Error('encoded payload too large');
        }
        const result = await callWxCloudFunction<CreateResult>('createPerformanceRecord', {
            durationMs: record.durationMs,
            stylePreset: record.stylePreset,
            title: record.title ?? '',
            eventsEncoded: encoded,
            eventCount: record.events.length,
            appVersion: record.appVersion,
        });
        if (!result?.recordId) throw new Error('missing recordId');
        return result.recordId;
    }

    static async getRecord(recordId: string): Promise<PerformanceRecord> {
        if (!recordId) throw new Error('recordId is required');
        const result = await callWxCloudFunction<GetResult>('getPerformanceRecord', { recordId });
        if (!result?.record) throw new Error('record not found');
        return result.record;
    }
}
