# 卡林巴琴点击反馈功能使用指南

## 🎯 功能概述

已实现的功能：
- ✅ 点击琴键时播放音效
- ✅ 支持多个琴键同时播放（合奏功能）
- ✅ 防止同一琴键重复点击
- ✅ 点击位置显示白色圆圈指示器
- ✅ 触摸反馈动画效果

## 🔧 组件说明

### 1. ClickIndicator.ts
**功能**: 点击指示圆圈组件
- 在点击位置显示白色半透明圆圈
- 自动播放缩放和淡出动画
- 动画结束后自动销毁

**主要属性**:
- `duration`: 指示器显示时长 (默认0.8秒)
- `maxScale`: 最大缩放比例 (默认1.5)
- `fadeOutDuration`: 淡出时长 (默认0.3秒)

### 2. AudioManager.ts (已更新)
**功能**: 音频管理器，支持合奏功能
- 管理多个音频源，支持同时播放6个音效
- 防止同一琴键重复点击
- 自动创建点击指示器

**新增功能**:
- `playKeySound(keyIndex, worldPos)`: 播放音效并显示指示器
- `getPlayingKeyCount()`: 获取当前播放的琴键数量
- `stopAllSounds()`: 停止所有播放

### 3. KalimbaKey.ts (已更新)
**功能**: 琴键组件，支持点击位置检测
- 检测触摸位置并传递给音频管理器
- 防止重复点击（通过AudioManager控制）
- 触摸反馈动画

### 4. KalimbaManager.ts (已更新)
**功能**: 卡林巴琴管理器
- 集成AudioManager
- 提供音量控制接口
- 管理所有琴键

## 🎮 使用方法

### 1. 在Cocos Creator中设置

#### 步骤1: 创建点击指示器预制体
1. 创建一个空节点，命名为 "ClickIndicator"
2. 添加 `Sprite` 组件
3. 添加 `ClickIndicator` 脚本
4. 设置一个白色圆形贴图
5. 保存为预制体

#### 步骤2: 配置AudioManager
1. 在场景中选择包含 `KalimbaManager` 的节点
2. 在 `AudioManager` 组件中：
   - 设置 `keySounds` 数组（17个音效文件）
   - 设置 `clickIndicatorPrefab` 为步骤1创建的预制体

#### 步骤3: 测试功能
1. 运行游戏
2. 点击任意琴键
3. 观察音效播放和白色圆圈指示器
4. 尝试同时点击多个琴键测试合奏功能

### 2. 代码使用示例

```typescript
// 获取音频管理器
const audioManager = this.getComponent(AudioManager);

// 播放指定琴键音效（带指示器）
audioManager.playKeySound(0, new Vec3(100, 200, 0));

// 设置音量
audioManager.setVolume(0.8);

// 停止所有音效
audioManager.stopAllSounds();

// 获取当前播放的琴键数量
const playingCount = audioManager.getPlayingKeyCount();
```

## 🎨 自定义配置

### 1. 调整指示器效果
在 `ClickIndicator` 组件中修改：
```typescript
@property
duration: number = 0.8;  // 显示时长

@property
maxScale: number = 1.5;  // 最大缩放

@property
fadeOutDuration: number = 0.3;  // 淡出时长
```

### 2. 调整指示器大小
在 `AudioManager.createClickIndicator()` 方法中：
```typescript
clickIndicator.setSize(60); // 修改指示器大小
```

### 3. 调整合奏数量
在 `AudioManager.createAudioSources()` 方法中：
```typescript
for (let i = 0; i < 5; i++) { // 修改数量，支持更多同时播放
    // ...
}
```

## 🔍 技术细节

### 1. 防重复点击机制
- 使用 `Set<number>` 跟踪正在播放的琴键
- 同一琴键播放期间忽略新的点击
- 音效播放结束后自动清除标记

### 2. 合奏实现
- 创建多个 `AudioSource` 组件
- 动态选择可用的音频源
- 支持最多6个音效同时播放

### 3. 点击位置检测
- 使用 `event.getUILocation()` 获取触摸位置
- 将UI坐标转换为世界坐标
- 在点击位置创建指示器

### 4. 指示器动画
- 缩放动画：从1.0到1.5倍
- 淡出动画：透明度从200到0
- 使用 `tween` 系统实现平滑动画

## 🐛 常见问题

### 1. 指示器不显示
**原因**: 没有设置 `clickIndicatorPrefab`
**解决**: 在AudioManager中正确设置预制体引用

### 2. 音效不播放
**原因**: 没有设置 `keySounds` 数组
**解决**: 确保所有17个音效文件都已正确设置

### 3. 合奏效果不明显
**原因**: 音效文件太短或音量太小
**解决**: 调整音效文件长度和音量设置

### 4. 指示器位置不准确
**原因**: 坐标转换问题
**解决**: 检查UI坐标到世界坐标的转换

## 🚀 性能优化建议

1. **指示器对象池**: 对于频繁点击，可以考虑使用对象池管理指示器
2. **音效预加载**: 确保音效文件在游戏开始时预加载
3. **内存管理**: 指示器会自动销毁，无需手动管理
4. **音频源数量**: 根据实际需求调整音频源数量

## 📱 移动端适配

- 触摸区域已优化，支持多点触控
- 指示器大小可根据屏幕尺寸调整
- 音效播放延迟已最小化

---

**注意**: 确保在Cocos Creator中正确设置所有组件引用，特别是预制体和音效文件。测试时建议先使用简单的音效文件验证功能。