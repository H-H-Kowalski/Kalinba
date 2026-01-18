# 双场景设置指南

## 🎯 场景结构

### 场景1: HomeScene (首页)
**功能**: 游戏主菜单，包含开始游戏、设置、关于等选项

### 场景2: GameScene (弹琴场景)  
**功能**: 卡林巴琴演奏界面，包含琴键、音量控制、返回按钮等

## 🛠️ 在Cocos Creator中设置场景

### 步骤1: 创建场景文件

1. **创建HomeScene场景**:
   - 右键 `assets` 文件夹 → `新建` → `场景`
   - 命名为 `HomeScene`
   - 保存到 `assets/scenes/` 目录

2. **创建GameScene场景**:
   - 右键 `assets` 文件夹 → `新建` → `场景`  
   - 命名为 `GameScene`
   - 保存到 `assets/scenes/` 目录

### 步骤2: 设置HomeScene场景

#### 场景层级结构:
```
HomeScene
├── Canvas
│   ├── Background (Sprite) - 背景图片
│   ├── Logo (Node) - 游戏Logo
│   ├── Title (Label) - 游戏标题
│   ├── PlayButton (Button) - 开始游戏按钮
│   ├── SettingsButton (Button) - 设置按钮
│   ├── AboutButton (Button) - 关于按钮
│   └── SceneManager (Node) - 场景管理器
```

#### 具体设置:
1. **Background**: 
   - 添加 `Sprite` 组件
   - 设置背景图片 (如 `bg_1.png`)

2. **Logo**:
   - 添加 `Sprite` 组件
   - 设置Logo图片
   - 位置: (0, 100, 0)

3. **Title**:
   - 添加 `Label` 组件
   - 文字: "卡林巴琴"
   - 字体大小: 48
   - 位置: (0, 50, 0)

4. **PlayButton**:
   - 添加 `Button` 组件
   - 文字: "开始游戏"
   - 位置: (0, -50, 0)

5. **SettingsButton**:
   - 添加 `Button` 组件
   - 文字: "设置"
   - 位置: (-100, -150, 0)

6. **AboutButton**:
   - 添加 `Button` 组件
   - 文字: "关于"
   - 位置: (100, -150, 0)

7. **SceneManager**:
   - 添加 `SceneManager` 脚本组件

8. **HomeScene**:
   - 在Canvas上添加 `HomeScene` 脚本组件
   - 将对应的按钮拖拽到脚本属性中

### 步骤3: 设置GameScene场景

#### 场景层级结构:
```
GameScene
├── Canvas
│   ├── Background (Sprite) - 背景图片
│   ├── KalimbaContainer (Node) - 琴键容器
│   │   └── KalimbaManager (Node) - 琴键管理器
│   ├── UIPanel (Node) - UI面板
│   │   ├── BackButton (Button) - 返回按钮
│   │   ├── MuteButton (Button) - 静音按钮
│   │   ├── VolumeSlider (Slider) - 音量滑块
│   │   ├── VolumeLabel (Label) - 音量显示
│   │   └── PlayingCountLabel (Label) - 播放数量显示
│   └── SceneManager (Node) - 场景管理器
```

#### 具体设置:
1. **Background**:
   - 添加 `Sprite` 组件
   - 设置背景图片

2. **KalimbaContainer**:
   - 创建空节点
   - 添加 `KalimbaManager` 脚本组件
   - 设置琴键预制体和参数

3. **UIPanel**:
   - 创建空节点
   - 位置: (0, -200, 0)

4. **BackButton**:
   - 添加 `Button` 组件
   - 文字: "返回"
   - 位置: (-200, 0, 0)

5. **MuteButton**:
   - 添加 `Button` 组件
   - 文字: "静音"
   - 位置: (0, 0, 0)

6. **VolumeSlider**:
   - 添加 `Slider` 组件
   - 位置: (100, 0, 0)
   - 进度: 0.8

7. **VolumeLabel**:
   - 添加 `Label` 组件
   - 文字: "音量: 80%"
   - 位置: (200, 0, 0)

8. **PlayingCountLabel**:
   - 添加 `Label` 组件
   - 文字: "正在播放: 0 个音效"
   - 位置: (0, 50, 0)

9. **SceneManager**:
   - 添加 `SceneManager` 脚本组件

10. **GameScene**:
    - 在Canvas上添加 `GameScene` 脚本组件
    - 将对应的组件拖拽到脚本属性中

### 步骤4: 设置场景切换

1. **在项目设置中注册场景**:
   - `项目` → `项目设置` → `场景列表`
   - 添加 `HomeScene` 和 `GameScene`

2. **设置启动场景**:
   - 将 `HomeScene` 设为启动场景

## 🎮 功能特性

### HomeScene功能:
- ✅ 美观的入场动画
- ✅ 按钮点击反馈
- ✅ 场景切换动画
- ✅ 设置和关于面板（可扩展）

### GameScene功能:
- ✅ 完整的卡林巴琴演奏功能
- ✅ 音量控制和静音
- ✅ 实时播放状态显示
- ✅ 返回首页功能

### SceneManager功能:
- ✅ 场景切换管理
- ✅ 场景预加载
- ✅ 当前场景检测

## 🔧 使用说明

### 场景切换流程:
1. 游戏启动 → HomeScene
2. 点击"开始游戏" → GameScene
3. 点击"返回" → HomeScene

### 代码调用示例:
```typescript
// 切换到游戏场景
const sceneManager = SceneManager.getInstance();
sceneManager.loadGameScene();

// 切换到首页场景
sceneManager.loadHomeScene();

// 检查当前场景
if (sceneManager.isInScene('HomeScene')) {
    console.log('当前在首页');
}
```

## 📱 移动端适配

- 所有UI元素都使用相对位置
- 支持不同屏幕尺寸
- 触摸按钮优化
- 响应式布局

## 🎨 视觉设计建议

### HomeScene:
- 温暖的背景色调
- 简洁的Logo设计
- 清晰的按钮布局
- 柔和的动画效果

### GameScene:
- 专业的演奏界面
- 清晰的琴键布局
- 直观的控制面板
- 实时状态反馈

---

**注意**: 确保在Cocos Creator中正确设置所有组件引用，特别是按钮和标签的引用。测试时建议先验证场景切换功能是否正常。


