# Claude 娘 · 终端版素材包

同人动画素材包（22 个动画），非官方作品，与 Anthropic 无关。注意它和 `assets/claude-girl/` 里的两张静态立绘不是同一份美术：立绘用于标题图形槽，这里用于伙伴面板/开屏吉祥物的逐帧动画。目录名沿用 `assets/whale-girl` / `assets/whaleGirl` 的约定——kebab 是静态立绘，驼峰是动画素材包。

## 目录

| 路径 | 说明 |
|---|---|
| `frames.json` | 字母格素材包（42×30、真彩调色板、22 个动画），无图像协议终端用半块字符渲染；格式与 `assets/deepy/frames.json` 相同，美术落在第 5–35 列（31 列，与鲸娘的字母轨开窗常量一致，两侧是透明衬垫） |
| `img/` | 图像协议（kitty/sixel）用的原生像素帧：`<key>/<两位帧号>.png`（288px 高、等比定宽 301px、保留真实 alpha）与 `timings.json`（key → `[{ dur, file }]`，225 帧全保留） |

`img/` 是这套素材的真源；`frames.json` 由它派生：

```sh
node scripts/build-girl-kit-from-frames.mjs assets/claudeGirl
```

源 GIF 只作预览，alpha 被压成 1bit 且缺 idle，不能当构建输入。

## 来源

素材为 AI 生成后逐帧整理；非官方作品。
