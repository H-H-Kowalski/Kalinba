/**
 * 微信小游戏全局 wx：真机上可能挂在 GameGlobal，仅 typeof wx 会漏判。
 */
export function getWx(): Record<string, unknown> | undefined {
    const g = globalThis as unknown as { wx?: Record<string, unknown>; GameGlobal?: { wx?: Record<string, unknown> } };
    return g.wx ?? g.GameGlobal?.wx;
}
