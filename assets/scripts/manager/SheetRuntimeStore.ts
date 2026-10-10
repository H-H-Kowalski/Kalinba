/** 跨场景记录当前是否为「单张长图纵向滚动」模式（由 SheetMusicBackground 写入，设置页读取） */
export class SheetRuntimeStore {
    private static longImageActive = false;
    static setLongImageActive(active: boolean): void {
        this.longImageActive = active;
    }

    static isLongImageActive(): boolean {
        return this.longImageActive;
    }
}
