import { _decorator, Component, AudioClip, AudioSource, resources, Node, instantiate, Prefab } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('AudioManager')
export class AudioManager extends Component {
    private static instance: AudioManager = null;
    
    @property([AudioClip])
    keySounds: AudioClip[] = [];
    
    @property(Prefab)
    clickIndicatorPrefab: Prefab = null;  // 点击指示器预制体
    
    private audioSource: AudioSource = null;
    private playingKeys: Set<number> = new Set();  // 正在播放的琴键
    private audioSources: AudioSource[] = [];  // 多个音频源用于合奏
    
    public static getInstance(): AudioManager {
        return AudioManager.instance;
    }
    
    start() {
        AudioManager.instance = this;
        
        // 获取音频组件
        this.audioSource = this.getComponent(AudioSource);
        if (!this.audioSource) {
            this.audioSource = this.addComponent(AudioSource);
        }
        
        // 设置音频属性
        this.audioSource.volume = 0.8;
        
        // 创建额外的音频源用于合奏
        this.createAudioSources();
    }
    
    /**
     * 创建额外的音频源用于合奏
     */
    private createAudioSources() {
        // 创建5个额外的音频源，支持最多6个同时播放
        for (let i = 0; i < 5; i++) {
            const audioSource = this.addComponent(AudioSource);
            audioSource.volume = 0.8;
            this.audioSources.push(audioSource);
        }
    }
    
    /**
     * 播放指定琴键的音效
     * @param keyIndex 琴键索引 (0-16)
     * @param worldPos 点击位置的世界坐标
     */
    playKeySound(keyIndex: number, worldPos?: Vec3) {
        // 检查琴键是否正在播放
        if (this.playingKeys.has(keyIndex)) {
            console.log(`琴键 ${keyIndex + 1} 正在播放中，忽略重复点击`);
            return;
        }
        
        if (keyIndex >= 0 && keyIndex < this.keySounds.length && this.keySounds[keyIndex]) {
            // 标记琴键为播放状态
            this.playingKeys.add(keyIndex);
            
            // 选择可用的音频源
            const audioSource = this.getAvailableAudioSource();
            if (audioSource) {
                audioSource.playOneShot(this.keySounds[keyIndex]);
                
                // 设置播放结束回调
                this.scheduleOnce(() => {
                    this.playingKeys.delete(keyIndex);
                }, this.keySounds[keyIndex].duration || 2.0);
            }
            
            // 创建点击指示器
            if (worldPos && this.clickIndicatorPrefab) {
                this.createClickIndicator(worldPos);
            }
        }
    }
    
    /**
     * 获取可用的音频源
     */
    private getAvailableAudioSource(): AudioSource | null {
        // 首先检查主音频源
        if (!this.audioSource.playing) {
            return this.audioSource;
        }
        
        // 检查额外的音频源
        for (const source of this.audioSources) {
            if (!source.playing) {
                return source;
            }
        }
        
        // 如果所有音频源都在使用，返回主音频源（会中断当前播放）
        return this.audioSource;
    }
    
    /**
     * 创建点击指示器
     * @param worldPos 世界坐标位置
     */
    private createClickIndicator(worldPos: Vec3) {
        if (!this.clickIndicatorPrefab) return;
        
        const indicator = instantiate(this.clickIndicatorPrefab);
        this.node.addChild(indicator);
        
        // 设置位置
        indicator.setPosition(worldPos);
        
        // 设置大小（根据琴键大小调整）
        const clickIndicator = indicator.getComponent('ClickIndicator');
        if (clickIndicator) {
            clickIndicator.setSize(60); // 指示器大小
        }
    }
    
    /**
     * 停止所有播放
     */
    stopAllSounds() {
        this.audioSource.stop();
        for (const source of this.audioSources) {
            source.stop();
        }
        this.playingKeys.clear();
    }
    
    /**
     * 设置音量
     * @param volume 音量 (0.0 - 1.0)
     */
    setVolume(volume: number) {
        const vol = Math.max(0, Math.min(1, volume));
        this.audioSource.volume = vol;
        for (const source of this.audioSources) {
            source.volume = vol;
        }
    }
    
    /**
     * 静音/取消静音
     */
    toggleMute() {
        const isMuted = this.audioSource.volume === 0;
        const volume = isMuted ? 0.8 : 0;
        this.setVolume(volume);
    }
    
    /**
     * 获取当前播放的琴键数量
     */
    getPlayingKeyCount(): number {
        return this.playingKeys.size;
    }
} 