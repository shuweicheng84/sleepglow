# 见微 · SleepGlow (Web MVP)

> 每天用几秒钟，轻盈地看见自己眼周的微小波动。全部计算都只存在于你的设备中。

## 技术栈

- **框架**：Next.js 14 (App Router) + React 18 + TypeScript
- **样式**：Tailwind CSS
- **动效**：Framer Motion
- **AI 能力**：`@mediapipe/tasks-vision` · FaceLandmarker（浏览器端 WebAssembly 推理）
- **存储**：浏览器 `localStorage`（仅存数值，不存图像）

## 核心逻辑

### 1. Day 1 · 基线建立

1. 用户授权前置摄像头，打开 Camera 页面。
2. 使用 MediaPipe FaceLandmarker 检测 468 个人脸关键点。
3. 通过一套**自适应面部尺度**的算法，定位左右眼下方的「黑眼圈高发区域」：
   - 使用多个 landmark 索引（如 145/159/160/144、374/386/387/380）估计眼下区域；
   - 根据整张脸的高度动态调整 ROI 尺寸和位置；
   - 左右眼分别计算 ROI 内像素的平均灰度亮度，再取平均。
4. 将这个亮度值记为 `baseline_score`，仅存入本地 `localStorage`：
   - `sleepglow_baseline_score`：基线亮度（单个数字）。

### 2. Day N · 变化量 Δ 计算

1. 用户再次拍照时，同样流程提取当次眼下区域亮度 `current_score`。
2. 与基线对比，计算相对变化量：

   \[
   \Delta\% = \frac{current - baseline}{baseline} \times 100
   \]

3. UI 只展示 **变化量（Δ）**，不展示任何「绝对分数」：
   - 提升：给出正向反馈文案（例如「眼周通透度比基线提升了 x%」）。
   - 下降：给出温和安慰文案（例如「也许只是一个更真实的早晨」）。
4. 同时，将当天的 Δ 以日期为 key 存入 `localStorage`：
   - `sleepglow_history_v1`：数组，元素为 `{ date: yyyy-mm-dd, deltaPercent, isFirst }`。
   - 用于在结果页显示**最近 7 天 Δ 变化的小趋势图**，依然只在本地渲染。

## 隐私设计（上线首屏 Onboarding 要点）

产品实现与文案一一对应：

- **只在本地计算：**
  - 摄像头画面只在内存中短暂存在，用于计算眼下 ROI 的亮度；
  - 不会被上传、不经任何远程服务器处理。
- **只保存数字，不保存图像：**
  - `localStorage` 中只写入：
    - 基线亮度：一个数字；
    - 每日 Δ 历史：日期 + Δ 百分比；
  - 不保存任何截图、照片文件，也不存关键点坐标或其他可识别人脸的原始特征。
- **界面层面的隐私保护：**
  - Camera 页在视频上叠加 `backdrop-blur` 和低对比滤镜，让用户看不清细节，缓解容貌焦虑；
  - Result 页从不展示真实照片，只用抽象「元气光环」+ Δ 文案；
  - 「保存今日元气日签」生成的是一张**纯前端绘制的抽象图片**，不包含人脸图像。

首页 (`landing` 状态) 已内置一块明显的隐私说明卡片，强调：

- “所有分析都只在你的设备本地完成”
- “摄像头画面仅在内存中短暂存在，不会被上传”
- “只在浏览器本地存亮度数字，不保存人脸特征”

## 运行与开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev
# 默认 http://localhost:3000

# 生产构建
npm run build
```

> 本项目使用 MediaPipe WebAssembly 模型文件的公共 CDN：
> - wasm 依赖：`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm`
> - FaceLandmarker 模型：Google 官方托管的 `.task` 文件

如需自托管模型，只需在 `app/page.tsx` 中替换对应 URL 即可。

## 部署到 Vercel（推荐）

1. 将本项目推送到 Git 仓库（GitHub / GitLab / Bitbucket 均可）。
2. 登录 Vercel，选择 **“Add New → Project”**，导入该仓库。
3. 保持默认配置：
   - Framework Preset: **Next.js**
   - Build Command: `npm run build`
   - Output Directory: `.next`
4. 点击 **Deploy**，等待构建完成，即可获得一个 `https://xxx.vercel.app` 域名。

部署后注意：

- 站点通过 **HTTPS** 提供服务，浏览器摄像头权限请求是被允许的；
- 所有 AI 推理都在用户浏览器完成，前端只从公共 CDN 拉取模型文件；
- 你可以随时在 Vercel 触发重新部署，前端逻辑更新后自动生效。

## 代码结构概览

- `app/layout.tsx`：根布局，设置全局样式与 `<body>` 背景。
- `app/page.tsx`：主单页应用，包含：
  - 状态机：`landing → camera → analyzing → result`
  - MediaPipe FaceLandmarker 的异步加载与销毁逻辑；
  - 摄像头视频流采集与隐藏 `canvas` 像素处理；
  - 眼下 ROI 亮度分析、基线/Δ 计算、本地历史记录；
  - UI 动效与元气光环可视化、趋势条形图。
- `app/globals.css`：Tailwind 引入与少量全局 class（如 `glass-panel`）。
- `tailwind.config.ts`：Tailwind 配置与渐变光效、扫描动画等扩展。

## 后续可迭代方向（建议）

- **体验侧：**
  - 增加「每日提醒」说明文案（不做推送，只是引导用户形成固定时间记录习惯）；
  - 在趋势图上增加「周 / 月」切换视图（仍然只基于 Δ）。
- **算法侧：**
  - 加入简单的光照归一化（例如参考额头/脸颊亮度，做相对校正）；
  - 在 ROI 内增加异常值抑制（中值滤波或裁剪极暗/极亮像素）。
- **工程侧：**
  - 将 MediaPipe 初始化与摄像头逻辑抽成 `useFaceLandmarker` / `useCameraStream` 自定义 hook；
  - 补充更细粒度的单元测试（针对 Δ 计算与历史合并逻辑）。

当前版本已经可以作为一个完整的、隐私友好的 SleepGlow Web MVP 上线使用。欢迎基于此继续打磨文案、动效与算法细节。 

