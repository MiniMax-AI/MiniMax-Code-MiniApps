# Signal Atlas：WebGL 自写示例

这是用于本地 H5 小游戏预览的独立原生工程，不需要微信账号。它不证明真机、发布或完整微信 SDK 兼容。

- `shaders.js` 提供真正的 GLSL vertex/fragment shader，由 `game.js` 以 CommonJS 加载。
- `wx.createImage` 解码本地 PNG，再由 `texImage2D` 上传到真实 WebGL 纹理；不使用绘图 mock。
- 画面持续旋转；点击切换纹理反色；`onHide` 停止动画，`onShow` 恢复。
- `GameGlobal.__demoGame.readCenter()` 返回真实像素和 GL 错误码，`snapshot()` 导出 PNG。
- WebGL 不可用时明确报错，不以 Canvas2D 替代后声称通过。

`assets/atlas.png` 为本项目自行生成的 32×32 RGBA 四色图片。代码和资源未复制微信或其他产品的实现。WebGL framebuffer 的读回原点在左下，不能直接把读回行序当成 Canvas2D 的屏幕行序。
