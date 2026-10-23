# Orbit Post：Canvas2D 自写示例

这是用于本地 H5 小游戏预览的独立原生工程，不需要微信账号。它不证明真机、发布或完整微信 SDK 兼容。

- `game.js` 使用 `wx.createCanvas`、`wx.createImage`、touch、Storage、`onShow/onHide` 和 RAF。
- 首个 Canvas 显示动画；第二个 Canvas 不挂到页面，用于本地 PNG 像素读回。
- 点击画面收集一个信号，分数写入 `orbitPostScore`，刷新后从 Storage 恢复。
- 业务自行按 `pixelRatio` 扩大 backing store，再将 2D 坐标缩放到逻辑像素。
- `GameGlobal.__demoGame` 暴露示例状态和 PNG 导出供验收，不是宿主 bridge。

`assets/quad.png` 为本项目自行生成的 2×2 RGBA 图片，四个像素依次为红、绿、蓝、白。代码和资源未复制微信或其他产品的实现。
