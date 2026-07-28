import { sys } from 'cc';

const KEY = 'kalinba_pending_challenge_level_v1';

/** 首页到演奏页的一次性挑战启动意图；避免用全局静态变量在场景切换时丢失。 */
export class ChallengeLaunchStore {
    static request(levelId = 'c1-01'): void {
        try {
            sys.localStorage.setItem(KEY, levelId || 'c1-01');
        } catch {
            // 无本地存储时仍可进入自由演奏，不阻断页面跳转。
        }
    }

    static take(): string {
        try {
            const id = sys.localStorage.getItem(KEY) ?? '';
            if (id) sys.localStorage.removeItem(KEY);
            return id;
        } catch {
            return '';
        }
    }
}
