<div align="center">

# Egern 小组件仓库

**透明玻璃风 Egern 小组件合集，glass / classic 双模式，浅色深色自适应。**

[![Egern](https://img.shields.io/badge/App-Egern-blue?logo=protonmail&logoColor=white&labelColor=0A0A0A)](https://egernapp.com)
[![Telegram](https://img.shields.io/badge/Telegram-@Yixiexiexzjian-26A5E4?logo=telegram&logoColor=white&labelColor=0A0A0A)](https://t.me/Yixiexiexzjian)
[![Platform](https://img.shields.io/badge/Platform-iOS%20%7C%20macOS%20%7C%20tvOS-8E8E93?logo=apple&logoColor=white&labelColor=0A0A0A)](https://egernapp.com/docs)
[![License](https://img.shields.io/badge/License-仅供参考-green?labelColor=0A0A0A)](#免责声明)

[![Widgets](https://img.shields.io/badge/小组件-12%20个-FF9F0A?labelColor=0A0A0A)](#小组件列表)
[![Glass](https://img.shields.io/badge/Glass-透明%20%2F%20经典-30D158?labelColor=0A0A0A)](#设计原则)

</div>

---

## 小组件列表

订阅方式：复制下表 Raw 链接，Egern → 模块 → 从 URL 安装。

| 小组件 | 内容 | 作者（原作者） |
|---|---|---|
| [天气·晴雨（透明版）](weather/WeatherWdg-glass.yaml) | 农历节气、逐时预报、五日预报、湿度进度条，中国天气网免 Key | 小龙女她爸 |
| [牛马表](schedule/Sched-Widget-pin.yaml) | 排班日历小组件，大小休自动排（周一固定休，双休周再休周二） | iBL3ND |
| [订阅流量监控（Hark 融合版·透明版）](traffic/sub-traffic-hark-merged-glass.yaml) | 仪表盘版与环形版合二为一，LAYOUT 切换版式，最多 4 个订阅 | zhaohantao1360-hash（Hark 改版） |
| [订阅流量监控（Hark 环形版·透明版）](traffic/sub-traffic-hark-rings-glass.yaml) | 最多 4 个订阅，同心圆环 + 列表样式，大号含近 7 天用量图 | zhaohantao1360-hash（Hark 改版） |
| [订阅流量监控（Hark 仪表盘版·透明版）](traffic/sub-traffic-hark-v2-glass.yaml) | 最多 4 个订阅，剩余流量、7 天用量柱状图、用完预测、到期时间 | zhaohantao1360-hash（Hark 改版） |
| [中国移动（Hark 融合版·透明版）](china-mobile/china-mobile-hark-merged-glass.yaml) | 剩余话费 + 流量/语音半圆仪表 + 近 7 天流量柱状图，CM_LAYOUT 切换版式 | zhaohantao1360-hash（Hark 改版） |
| [中国移动（Hark 仪表盘版）· 透明版](china-mobile/china-mobile-hark-dash-glass.yaml) | 剩余话费 + 流量/语音半圆仪表 + 近 7 天流量柱状图 | zhaohantao1360-hash（Hark 改版） |
| [Egern「网络诊断雷达」（透明版）](network/wangluozhenduanleida-glass.yaml) | 网络诊断雷达，通用脚本生成界面 | lylywayr |
| [NetSpeed 10s 测速 · 透明版](network/NetSpeed_Widget_10s-glass.yaml) | 持续测速 10 秒，逐秒记录，显示平均值与逐秒数据，节点信息整合 IPPure | BiaoerD |
| [📌 全国油价 (Gas Price) 小组件 · 透明版](oil-price/shishiyoujia-glass.yaml) | 全国实时油价，三端尺寸适配 | mickeu |
| [包裹助手](parcel/Parcel-Helper.yaml) | 打开菜鸟刷一次“我的包裹”即同步快照，到站显示取件码并通知（v29） | pin |
| [包裹抓包探针](parcel/Parcel-Probe.yaml) | 测试 Egern 能不能抓到淘宝登录 cookie，为包裹自动读取探路（v10） | pin |

## 设计原则

- **透明版默认 glass**：根容器不设 `backgroundColor` / `backgroundGradient`，壁纸透出来；逐时条、预警框等改半透明 `rgba`。
- **classic 保持原版**：`WIDGET_STYLE=classic` 切回原版纯色，glass 与 classic 各用一组、互不影响。
- **浅色深色自适应**：glass 跟着 iOS 浅色/深色自动切（浅色品牌色块、深色全透明只留字母）。
- **布局、字号、颜色一处没动**：只动透明相关的背景与底色，其余原样。

## 目录结构

```
weather/        天气
schedule/       排班（牛马表）
traffic/        订阅流量（Hark 环形版 / 仪表盘版 / 融合版）
china-mobile/   中国移动（Hark 仪表盘版 / 融合版）
network/        网络诊断雷达、网速测速
oil-price/      实时油价
parcel/         包裹助手、包裹抓包探针
```

每个小组件由一对文件组成：`.yaml`（Egern 模块，导入用）+ `.js`（小组件脚本，模块内引用）。

## 免责声明

仅供参考学习，请勿用于商业用途。各小组件版权归原作者所有，改版已注明原作者。
