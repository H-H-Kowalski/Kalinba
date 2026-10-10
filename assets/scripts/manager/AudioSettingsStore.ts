import { sys } from 'cc';
import type { AudioManager } from './AudioManager';

const KEY = 'kalinba_audio_settings_v1';

/**
 * WebAudio 主输出保持在线性安全区。手机外放的动态余量远小于桌面浏览器，
 * 过高增益会持续顶住压缩器，听起来像破音、颤动或音高异常。
 */
export const DEFAULT_APP_GAIN = 1.15;

export interface AudioSettingsSnapshot {
    useSynth: boolean;
    synthStylePreset: number;
    useManualSynthTuning: boolean;
}

export class AudioSettingsStore {
    static defaultSnapshot(): AudioSettingsSnapshot {
        return {
            useSynth: true,
            synthStylePreset: 1,
            useManualSynthTuning: false,
        };
    }

    static load(): AudioSettingsSnapshot {
        try {
            const raw = sys.localStorage.getItem(KEY);
            if (!raw) return this.defaultSnapshot();
            const o = JSON.parse(raw) as Partial<AudioSettingsSnapshot>;
            const d = this.defaultSnapshot();
            return {
                useSynth: typeof o.useSynth === 'boolean' ? o.useSynth : d.useSynth,
                synthStylePreset:
                    typeof o.synthStylePreset === 'number' && o.synthStylePreset >= 0 && o.synthStylePreset <= 4
                        ? Math.floor(o.synthStylePreset)
                        : d.synthStylePreset,
                // 旧版本曾允许 Inspector 手动参数覆盖预设；现在统一使用经过真机约束的五档音色。
                useManualSynthTuning: false,
            };
        } catch {
            return this.defaultSnapshot();
        }
    }

    static save(partial: Partial<AudioSettingsSnapshot>): void {
        const cur = this.load();
        const next: AudioSettingsSnapshot = { ...cur, ...partial };
        try {
            sys.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
            // ignore
        }
    }

    /** 从存档恢复到 AudioManager（在 AudioManager.start 末尾调用） */
    static applyToAudioManager(am: AudioManager): void {
        const s = this.load();
        // 固定合成音策略：忽略存档里的 useSynth
        am.setUseSynth(true);
        am.setSynthStylePreset(s.synthStylePreset);
        am.setUseManualSynthTuning(false);
        am.setVolume(DEFAULT_APP_GAIN);
    }

    static saveFromAudioManager(am: AudioManager): void {
        this.save({
            useSynth: true,
            synthStylePreset: am.getSynthStylePreset(),
            useManualSynthTuning: am.getUseManualSynthTuning(),
        });
    }
}
