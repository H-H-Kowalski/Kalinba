import { getWx } from './WeChatNative';

// 与已部署的演奏分享、内容审核函数保持一致，不依赖控制台的默认环境。
export const WECHAT_CLOUD_ENV = 'cloud1-2gvremt83958d276';

type CloudCallResult<T> = {
    result?: T;
};

type CloudCallFailure = {
    errMsg?: string;
    message?: string;
    errCode?: number;
    requestID?: string;
};

type MaybePromise<T> = {
    then?: (
        onFulfilled: (value: T) => void,
        onRejected?: (reason: unknown) => void,
    ) => unknown;
};

/**
 * 微信云函数在不同基础库/运行环境中可能返回 Promise，也可能只走 success/fail。
 * 统一包成标准 Promise，避免对 undefined 直接调用 .then()。
 */
export function callWxCloudFunction<T>(name: string, data: Record<string, unknown>): Promise<T> {
    const wxApi = getWx() as {
        cloud?: {
            callFunction?: (arg: {
                name: string;
                data: Record<string, unknown>;
                config: { env: string };
                success?: (res: CloudCallResult<T>) => void;
                fail?: (err: CloudCallFailure | unknown) => void;
            }) => MaybePromise<CloudCallResult<T>> | void;
        };
    } | undefined;
    const cloud = wxApi?.cloud;
    const callFunction = cloud?.callFunction;
    if (!callFunction) {
        return Promise.reject(new Error('wx.cloud.callFunction is unavailable'));
    }

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const started = Date.now();
        // 请求超时只结束等待，不自动重发写入，避免重复创建录音或累计成就。
        const timer = setTimeout(() => fail(new Error('请求超时，请检查网络后重试')), 20000);
        const succeed = (res: CloudCallResult<T>) => {
            if (settled) return;
            if (res?.result === undefined || res?.result === null) {
                fail(new Error('empty cloud result'));
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(res.result);
        };
        const fail = (reason: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const errMsg = typeof (reason as CloudCallFailure | undefined)?.errMsg === 'string'
                ? (reason as CloudCallFailure).errMsg
                : reason instanceof Error
                    ? reason.message
                    : (reason as CloudCallFailure | undefined)?.message || String(reason || 'unknown error');
            console.error('[CloudCall:v3] failed', {
                name, env: WECHAT_CLOUD_ENV, elapsedMs: Date.now() - started, message: errMsg,
                errCode: (reason as CloudCallFailure | undefined)?.errCode,
                requestID: (reason as CloudCallFailure | undefined)?.requestID,
                stack: reason instanceof Error ? reason.stack : undefined,
            });
            reject(new Error(`${name}: ${errMsg}`));
        };

        try {
            const returned = callFunction.call(cloud, {
                name, data, config: { env: WECHAT_CLOUD_ENV }, success: succeed, fail,
            });
            // 新基础库通常返回 Promise；旧基础库/部分适配层返回 void，只触发回调。
            if (returned != null && typeof returned.then === 'function') {
                // Promise.resolve 负责接管原生 thenable；不依赖其 then 返回标准 Promise。
                Promise.resolve(returned as PromiseLike<CloudCallResult<T>>).then(succeed, fail);
            }
        } catch (e) {
            fail(e);
        }
    });
}
