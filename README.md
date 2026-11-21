# 在线版 · PlayCarGame（3D 赛车公路竞速 · 双人联机）

线上体验：<https://api.game.yhj123.dpdns.org/>  
GitHub（在线联机版）：<https://github.com/wudibuzaijimo123/zaixianyouxi>

纯原生 **Node.js + Three.js** 实现，零第三方 npm 依赖（无需 `npm install`），下载后一条命令即可在本地 `localhost` 运行或部署到自己的云服务器上与朋友联机。

---

## 🚀 一、本地运行（Localhost）

> 只需安装 **Node.js >= 18**，无需安装任何额外依赖包。

```bash
# 1. 克隆仓库
git clone https://github.com/wudibuzaijimo123/zaixianyouxi.git
cd zaixianyouxi

# 2. 启动服务端与前端（默认 3000 端口）
node server.js
# 或使用 npm start
```

打开浏览器访问：<http://localhost:3000/>

- **指定自定义端口**（例如 `3210`）：
  - **Linux / macOS**：`PORT=3210 node server.js` → 访问 `http://localhost:3210/`
  - **Windows PowerShell**：`$env:PORT=3210; node server.js` → 访问 `http://localhost:3210/`
- **局域网双人联机测试**：在同一 Wi-Fi 下，电脑运行 `node server.js`，手机浏览器访问 `http://<你电脑的局域网IP>:3000/` 即可双设备实时开房间联机！

---

## ☁️ 二、在自己的 Linux 服务器部署上线

下面以常见的 **Ubuntu / Debian / CentOS** 云服务器（Node.js >= 18 + Nginx）为例：

### 1. 准备环境并拉取代码

```bash
# 以 root 或 sudo 权限执行
mkdir -p /opt
cd /opt
git clone https://github.com/wudibuzaijimo123/zaixianyouxi.git playcargame
cd /opt/playcargame
mkdir -p data
```

先测试能否直接跑通：

```bash
PORT=3210 node /opt/playcargame/server.js
# 新开终端检查：curl http://127.0.0.1:3210/api/health
```

### 2. 配置开机自启（systemd 守护进程）

可直接复用仓库内置的 [`deploy/systemd/playcargame.service`](deploy/systemd/playcargame.service)：

```bash
cp /opt/playcargame/deploy/systemd/playcargame.service /etc/systemd/system/playcargame.service
systemctl daemon-reload
systemctl enable --now playcargame
systemctl status playcargame
```

验证服务监听：`curl -fsS http://127.0.0.1:3210/api/health` 返回 `{"ok":true,...}` 即表示后端运行正常。

> 如果习惯用 `pm2`：也可以直接执行 `PORT=3210 pm2 start /opt/playcargame/server.js --name playcargame && pm2 save`。

### 3. 配置 Nginx 反向代理（含 SSE 实时推送支持）

新建 `/etc/nginx/conf.d/playcargame.conf`（把 `your-domain.com` 换成你的域名，若无域名可用服务器公网 IP 并删除 `server_name` 限制或改用独立端口）：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 关键：关闭缓冲保证 /api/race/stream (SSE) 双人位置毫秒级实时推送
        proxy_buffering off;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
}
```

检查并重载 Nginx：

```bash
nginx -t && systemctl reload nginx
```

> - 前后端通过同一个 Node 服务同源托管（前端会优先请求当前域名的 `/api/*`），部署在任何自己的域名或 IP 下**无需修改前端代码**。
> - 如需开启 HTTPS，可安装 Certbot 后运行 `certbot --nginx -d your-domain.com`；云服务器安全组请放行 `80` / `443` 端口。
> - 如果不想用 Nginx 仅个人临时联机测试，也可以直接放行服务器 `3210` 端口，浏览器访问 `http://<服务器IP>:3210/`（部分浏览器限制 HTTP 下的手机倾斜传感器权限，正式游玩建议上 HTTPS）。

---

## 🎮 三、玩法与双人联机规则

1. **双人房间（《王者荣耀》开黑房流程）**：
   - **房主**：输入任意 3~8 位房号（或留空直接点）点 **「创建」**，进入双人席位房间，固定分列**左侧车道**。发车前房主可随时自由修改 **赛道主题 / 比赛距离 / 车流难度**（修改后会自动重置准备状态以便双方重新确认）。
   - **好友**：输入相同房号点 **「进入」**，自动分列**右侧车道**并锁定同步房主设置。
   - **准备发车**：两人在卡片区确认设置后都点下 **「点击准备」**，席位变绿即开启 **3 秒倒计时**同时出发。
   - **对局退出 / 再来一局**：中途点右上角「退出」会保留当前房间与两人席位回到准备区（需彻底退房点「退出房间」）；完赛后点「再跑一圈 / 再来一局」同样保留房号与房主配置回到准备区。
2. **赛程与赛道**：
   - 支持 **3 km / 5 km（默认）/ 8 km / 12 km** 赛程；每 2400 m 为一圈复合多弯山路与环形发卡弯（`trackCurve`），配备左上角 CS:GO 风格圆形战术雷达。
3. **驾驶与胜负判定**：
   - 最高时速 `200 km/h`，带加速抬头/刹车点头纵倾、真实渐进刹车减速度与氮气加速；手机支持左下角双键或顶栏「倾斜转向」+ 碰撞震动反馈。
   - 率先冲线者获胜；一方冲线后开启 **10 秒**倒计时窗口，10 秒内对手未冲线则结束比赛并对比成绩。

---

## 🚦 四、快速调整车流密度

打开 [`game.js`](game.js)，修改顶部常量即可调整刷车手感：

```js
const TRAFFIC_REFERENCE_SPEED_KMH = 200;
const TRAFFIC_IDLE_INTERVAL_MS = 1450;
const TRAFFIC_FAST_INTERVAL_MS = 950;
const TRAFFIC_MAX_ACTIVE = 32;
const TRAFFIC_DOUBLE_WAVE_RATIO = 0.3;
```

- `TRAFFIC_IDLE_INTERVAL_MS` / `TRAFFIC_FAST_INTERVAL_MS`：静止与高速时的刷车波次间隔（ms）。
- `TRAFFIC_MAX_ACTIVE`：场上同屏 AI 车辆上限（手机与电脑共用）。
- `TRAFFIC_DOUBLE_WAVE_RATIO`：单波双车并排出现概率（3 车道始终至少留有通车空隙）。

---

## 📁 五、文件说明与 API 接口

| 文件 / 目录 | 作用 |
| --- | --- |
| [`index.html`](index.html) | 页面结构：3D 画布、CS:GO 圆形小地图、HUD、排行榜、双人席位卡片与音频标签 |
| [`game.js`](game.js) | 核心逻辑：Three.js 渲染（全景天空穹顶/柔和云层/PBR 车模）、2400m 环山赛道、车辆动力学与刹车减速度、AI 车流、SSE 联机与小地图、7 首邓紫棋歌单与声效引擎 |
| [`style.css`](style.css) | 界面样式（桌面与移动端拇指触控适配） |
| [`server.js`](server.js) | Node 后端：静态托管（支持音频 206 Range 流式加载）、排行榜持久化、房间管理、准备锁与 40ms SSE 推送 |
| [`assets/`](assets) | 本地 `three.min.js`、碰撞/金币音效及 7 首邓紫棋 MP3 歌单（不依赖外部 CDN） |
| `data/scores.json` | 排行榜数据（运行后自动生成，按用时升序） |
| [`deploy/`](deploy) | `systemd` 与 `Nginx` 生产部署参考配置 |

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 服务存活检查 |
| `GET` / `POST` | `/api/scores` | 获取或提交排行榜成绩 `{name, time}` |
| `POST` | `/api/race/rooms` | 创建或加入双人房间 `{action, roomCode, name, finishDistance, theme, difficulty}` |
| `POST` | `/api/race/ready` | 切换准备状态 `{roomCode, playerId, ready}`，双方均 ready 后启动 3 秒倒计时 |
| `POST` | `/api/race/rematch` | 完赛再来一局或中途退回双人准备区 `{roomCode, playerId, forceLobby}` |
| `POST` | `/api/race/state` | 上报里程/坐标/状态并同步房主配置 |
| `POST` | `/api/race/leave` | 彻底退出房间释放座位 |
| `GET` | `/api/race/stream` | SSE 实时推送房间与对手状态（40ms） |
