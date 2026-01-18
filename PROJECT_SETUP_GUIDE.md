# 卡林巴琴项目场景设置指南

## 📁 你的项目结构

```
assets/
├── mainscene.scene          # 首页场景
├── playscene.scene          # 弹琴场景
├── scripts/
│   ├── HomeScene.ts         # 首页场景脚本
│   ├── GameScene.ts         # 弹琴场景脚本
│   ├── SceneManager.ts      # 场景管理器
│   ├── KalimbaManager.ts    # 琴键管理器
│   ├── KalimbaKey.ts        # 琴键脚本
│   ├── AudioManager.ts      # 音频管理器
│   └── ClickIndicator.ts    # 点击指示器
├── Image/
│   ├── bg_1.png            # 背景图片1
│   ├── bg_2.png            # 背景图片2
│   ├── bg_play_1.png       # 游戏背景
│   ├── key_white.png       # 白色琴键
│   └── key_white_slim.png  # 细长白色琴键
└── audio/                   # 音效文件夹
```

## 🎯 场景设置步骤

### 步骤1: 设置mainscene.scene (首页)

#### 1.1 打开mainscene.scene
1. 在Cocos Creator中双击 `mainscene.scene`
2. 确保场景编辑器打开

#### 1.2 创建场景结构
在层级管理器中创建以下结构：
```
mainscene
└── Canvas
    ├── Background (Sprite) - 使用bg_1.png
    ├── Logo (Sprite) - 可以创建一个简单的Logo
    ├── Title (Label) - "卡林巴琴"
    ├── PlayButton (Button) - "开始游戏"
    ├── SettingsButton (Button) - "设置"
    ├── AboutButton (Button) - "关于"
    └── SceneManager (Node) - 空节点，用于场景管理
```

#### 1.3 添加HomeScene脚本
1. 选择 `Canvas` 节点
2. 在属性检查器中点击 **"添加组件"**
3. 选择 **"自定义脚本"** → **"HomeScene"**
4. 设置脚本属性：
   - `Play Button`: 拖拽 `PlayButton` 节点
   - `Settings Button`: 拖拽 `SettingsButton` 节点
   - `About Button`: 拖拽 `AboutButton` 节点
   - `Title Label`: 拖拽 `Title` 节点
   - `Background Sprite`: 拖拽 `Background` 节点
   - `Logo Node`: 拖拽 `Logo` 节点

#### 1.4 添加SceneManager脚本
1. 选择 `SceneManager` 节点
2. 添加 **"SceneManager"** 脚本组件

### 步骤2: 设置playscene.scene (弹琴场景)

#### 2.1 打开playscene.scene
1. 双击 `playscene.scene`
2. 确保场景编辑器打开

#### 2.2 创建场景结构
```
playscene
└── Canvas
    ├── Background (Sprite) - 使用bg_play_1.png
    ├── KalimbaContainer (Node)
    │   └── KalimbaManager (Node)
    ├── UIPanel (Node)
    │   ├── BackButton (Button) - "返回"
    │   ├── MuteButton (Button) - "静音"
    │   ├── VolumeSlider (Slider) - 音量滑块
    │   ├── VolumeLabel (Label) - "音量: 80%"
    │   └── PlayingCountLabel (Label) - "正在播放: 0 个音效"
    └── SceneManager (Node) - 空节点
```

#### 2.3 添加GameScene脚本
1. 选择 `Canvas` 节点
2. 添加 **"GameScene"** 脚本组件
3. 设置脚本属性：
   - `Kalimba Manager`: 拖拽 `KalimbaManager` 节点
   - `Back Button`: 拖拽 `BackButton` 节点
   - `Mute Button`: 拖拽 `MuteButton` 节点
   - `Volume Slider`: 拖拽 `VolumeSlider` 节点
   - `Volume Label`: 拖拽 `VolumeLabel` 节点
   - `Playing Count Label`: 拖拽 `PlayingCountLabel` 节点
   - `UI Panel`: 拖拽 `UIPanel` 节点

#### 2.4 设置KalimbaManager
1. 选择 `KalimbaManager` 节点
2. 添加 **"KalimbaManager"** 脚本组件
3. 设置脚本属性：
   - `Key Prefab`: 需要创建琴键预制体
   - `Key Count`: 17
   - `Key Spacing`: 60
   - `Key Width`: 50
   - `Key Height`: 250

#### 2.5 创建琴键预制体
1. 创建空节点，命名为 `KeyPrefab`
2. 添加以下组件：
   - `Sprite` 组件 (使用key_white.png)
   - `Button` 组件
   - `KalimbaKey` 脚本组件
3. 设置KalimbaKey属性：
   - `Key Index`: 0 (会在代码中动态设置)
   - `Pressed Color`: (180, 180, 200, 255)
   - `Normal Color`: (255, 255, 255, 255)
4. 保存为预制体到 `assets/prefabs/KeyPrefab.prefab`

#### 2.6 设置AudioManager
1. 选择 `KalimbaManager` 节点
2. 添加 **"AudioManager"** 脚本组件
3. 设置脚本属性：
   - `Key Sounds`: 添加17个音效文件
   - `Click Indicator Prefab`: 创建点击指示器预制体

#### 2.7 创建点击指示器预制体
1. 创建空节点，命名为 `ClickIndicatorPrefab`
2. 添加以下组件：
   - `Sprite` 组件 (白色圆形贴图)
   - `ClickIndicator` 脚本组件
3. 保存为预制体到 `assets/prefabs/ClickIndicatorPrefab.prefab`

#### 2.8 添加SceneManager脚本
1. 选择 `SceneManager` 节点
2. 添加 **"SceneManager"** 脚本组件

## 🎮 具体操作步骤

### 在mainscene.scene中：

1. **设置背景**：
   - 创建Sprite节点，命名为 `Background`
   - 在Sprite组件中设置 `bg_1.png` 作为贴图
   - 调整大小填满屏幕

2. **设置标题**：
   - 创建Label节点，命名为 `Title`
   - 设置文字为"卡林巴琴"
   - 字体大小：48
   - 位置：(0, 100, 0)

3. **设置按钮**：
   - 创建Button节点，命名为 `PlayButton`
   - 设置文字为"开始游戏"
   - 位置：(0, 0, 0)
   - 重复创建 `SettingsButton` 和 `AboutButton`

### 在playscene.scene中：

1. **设置背景**：
   - 创建Sprite节点，命名为 `Background`
   - 设置 `bg_play_1.png` 作为贴图

2. **设置琴键容器**：
   - 创建空节点，命名为 `KalimbaContainer`
   - 在其下创建 `KalimbaManager` 节点

3. **设置UI面板**：
   - 创建空节点，命名为 `UIPanel`
   - 位置：(0, -200, 0)
   - 在其下创建各种UI控件

## 🔧 项目设置

### 1. 设置启动场景
1. 打开 **"项目设置"**
2. 在 **"场景列表"** 中添加：
   - `mainscene`
   - `playscene`
3. 将 `mainscene` 设为启动场景

### 2. 创建预制体文件夹
1. 在 `assets` 下创建 `prefabs` 文件夹
2. 将琴键预制体和点击指示器预制体保存到此处

### 3. 准备音效文件
1. 在 `assets/audio` 文件夹中放置17个音效文件
2. 建议命名为：`key_01.mp3`, `key_02.mp3`, ..., `key_17.mp3`

## ✅ 检查清单

### mainscene.scene检查：
- [ ] Canvas节点存在
- [ ] Background节点存在并设置了bg_1.png
- [ ] Title节点存在并设置了文字
- [ ] PlayButton、SettingsButton、AboutButton节点存在
- [ ] HomeScene脚本已添加到Canvas
- [ ] 所有脚本属性都已正确设置
- [ ] SceneManager脚本已添加

### playscene.scene检查：
- [ ] Canvas节点存在
- [ ] Background节点存在并设置了bg_play_1.png
- [ ] KalimbaContainer和KalimbaManager节点存在
- [ ] UIPanel及其子节点存在
- [ ] GameScene脚本已添加到Canvas
- [ ] KalimbaManager脚本已添加并设置了琴键预制体
- [ ] AudioManager脚本已添加并设置了音效文件
- [ ] 所有脚本属性都已正确设置

## 🚀 测试步骤

1. **运行mainscene**：
   - 点击播放按钮
   - 检查首页是否正常显示
   - 测试按钮点击效果

2. **测试场景切换**：
   - 点击"开始游戏"按钮
   - 检查是否切换到playscene
   - 测试返回功能

3. **测试弹琴功能**：
   - 点击琴键测试音效
   - 测试音量控制
   - 测试静音功能
   - 测试点击指示器

## 🐛 常见问题

### 问题1: 场景切换失败
**解决**: 检查SceneManager中的场景名称是否正确

### 问题2: 琴键不显示
**解决**: 检查KalimbaManager的KeyPrefab属性是否正确设置

### 问题3: 音效不播放
**解决**: 检查AudioManager的KeySounds数组是否正确设置

### 问题4: 点击指示器不显示
**解决**: 检查ClickIndicatorPrefab是否正确设置

---

**注意**: 确保所有脚本文件都在 `assets/scripts/` 目录下，并且没有TypeScript语法错误。测试时建议先验证基本功能，再逐步添加复杂功能。


