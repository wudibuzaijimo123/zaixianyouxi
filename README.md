# 在线版 · PlayCarGame（3D 公路自驾 · 双人联机比赛）

线上地址：<https://api.game.yhj123.dpdns.org/>

## 🚦 快速调整车流刷新频率（先看这里）

打开 [`game.js`](game.js)，修改这些参数：

```js
const TRAFFIC_REFERENCE_SPEED_KMH = 200;
const TRAFFIC_IDLE_INTERVAL_MS = 1450;
const TRAFFIC_FAST_INTERVAL_MS = 950;
const TRAFFIC_MAX_ACTIVE = 32;
const TRAFFIC_DOUBLE_WAVE_RATIO = 0.3;
```

- `TRAFFIC_IDLE_INTERVAL_MS`：低速端的刷新间隔。改小会让低速和中速时刷得更频繁；例如 `1450` 改成 `1300`，静止时从约 1.45 秒缩短到 1.3 秒。
- `TRAFFIC_FAST_INTERVAL_MS`：达到参考车速时的刷新间隔。改小会让高速时刷得更频繁；当前为 950 ms，达到 200 km/h 时约 0.95 秒一波。
- `TRAFFIC_REFERENCE_SPEED_KMH`：高速间隔对应的车速。当前为 200 km/h；达到或超过它后使用 `TRAFFIC_FAST_INTERVAL_MS`。
- `TRAFFIC_MAX_ACTIVE`：手机和电脑共用的场上车辆上限，当前都是 32 辆。
- `TRAFFIC_DOUBLE_WAVE_RATIO`：车速累计到 1 后刷双车的频率。当前为 `0.3`，200 km/h 时约每 3.3 波有一波双车；高速平均约 1.37 辆/秒，比 0.62 秒单车一波的设置少约 15%。改小会让双车波次更少。

计算逻辑在 `update()` 中：车速越快，`trafficSpeedRatio` 越接近 1，算出的 `trafficInterval` 越小；当经过时间超过间隔时，`if` 条件调用 `spawnTraffic()`。因此它控制的是**每秒刷几波车**。

每波刷几辆由 `spawnTraffic()` 里的 `trafficDensityAccumulator` 决定：速度越高，双车波次越多；车道从三条车道中随机抽取且不重复，因此高速时中间车道约 57% 的波次开放、其余波次有车，不会一直空着。开局只布置 6 辆车，左右并排的波次会给中间留出通道。同样车速和波次数时，各设备刷出的车辆数相同。

## 双人联机起跑与碰撞

联机倒计时只由服务器统一安排：房间内两位车手都持续在线后才倒计时；发车前任何一位离开或掉线，倒计时会取消并等待对手回来。客户端不会自行补开倒计时。

车辆按约 2.4 m 宽、4.9 m 长的车身矩形计算碰撞，并跟随弯道调整朝向。碰撞盒不再扩到半条车道宽，车身能实际通过的间隙就可以通过。撞击反馈有全局冷却且保留最低滚行速度，避免撞到多辆车时速度连乘到停住。

前端、后端、房间同步都跑在同一台阿里云服务器上（部署目录 `/opt/playcargame`，仓库根目录与之对应），页面与 `/api/*` 同源。

## 文件说明

| 文件 / 目录 | 作用 |
| --- | --- |
| [`index.html`](index.html) | 页面骨架：3D 画布、HUD（车速 / 比赛用时 / 最佳用时）、车王排行榜、房间入口、快捷键设置、小地图画布、音乐开关 |
| [`game.js`](game.js) | 游戏主逻辑：Three.js 场景与赛道（含 U 型弯）、车辆物理、AI 车流、实体碰撞、计时与冲线判定、联机房间（SSE 实时同步）、小地图绘制、音效引擎 |
| [`style.css`](style.css) | 全部界面样式（含移动端拇指控制布局） |
| [`assets/three.min.js`](assets/three.min.js) | 本地 Three.js 引擎，不依赖 CDN |
| [`assets/bgm.wav`](assets/bgm.wav) | 背景音乐（默认静音，点右上角喇叭才播放） |
| [`assets/crash.wav`](assets/crash.wav) | 撞击音效 |
| [`assets/coin.wav`](assets/coin.wav) | 金币音效 |
| [`server.js`](server.js) | Node 后端：静态托管、成绩接口、房间接口、SSE 实时推送、5 秒判负 |
| [`package.json`](package.json) | Node 项目描述与启动脚本 |
| `data/scores.json` | 排行榜数据（运行时生成，按用时排序，不进 git） |
| [`deploy/bootstrap.sh`](deploy/bootstrap.sh) | 服务器首次部署：克隆代码、恢复 `data/`、装 systemd + nginx、签发证书 |
| [`deploy/deploy.sh`](deploy/deploy.sh) | 日常发布：`git pull` → 重启服务 → `nginx -t` → 健康检查 |
| [`deploy/enable-tls.sh`](deploy/enable-tls.sh) | DNS 指向本机后一键签发证书并切到 443 |
| [`deploy/nginx/game.yhj123.dpdns.org.conf`](deploy/nginx/game.yhj123.dpdns.org.conf) | 正式站点配置（80 跳转 + 443 反代到 Node） |
| [`deploy/nginx/game.yhj123.dpdns.org.http.conf`](deploy/nginx/game.yhj123.dpdns.org.http.conf) | 过渡配置（只有 80，证书未签发时使用） |
| [`deploy/systemd/playcargame.service`](deploy/systemd/playcargame.service) | 常驻服务定义（端口 3210，开机自启） |
| [`scripts/deploy-remote.ps1`](scripts/deploy-remote.ps1) | Windows 本地一键：提交 → 推送 → 远端发布 |
| [`docs/FRAMEWORK.md`](docs/FRAMEWORK.md) | 架构说明、接口清单、改游戏逻辑时的注意事项 |

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活检查 |
| GET | `/api/scores` | 排行榜（按用时升序） |
| POST | `/api/scores` | 提交成绩 `{name, time}`，同名只留最快 |
| POST | `/api/race/rooms` | `{action:"create", roomCode, name, finishDistance}` 房主建房；`{action:"join", roomCode, name}` 对方加入 |
| POST | `/api/race/state` | 上报自身状态 `{roomCode, playerId, x, heading, speed, distance, finished, time}` |
| POST | `/api/race/leave` | 退出房间，释放座位 |
| GET | `/api/race/stream` | SSE 实时推送房间内对手状态（每 40ms） |

## 玩法与规则

1. **房主**填房间号 → 选比赛距离（1.5 km / 3 km）→ 点「创建房间」
2. **对方**填同一个房间号 → 点「加入」（距离选项此时锁定，由房主决定）
3. 两人都在场（3.5 秒内有心跳）才会出现 3-2-1 倒计时，同时起步
4. 只有自己踩油门才走，松手约 1 秒停住，时速上限 200 km/h
5. 撞到 AI 车是「弹开 + 减速」，不会出局
6. 先到终点者胜；一方冲线后 **5 秒**内对手仍未到终点，比赛强制结束并判负
7. 结算面板显示双方用时、冲线速度、最高速度；排行榜按用时升序，自己的名字高亮

## 本地开发

```bash
node server.js      # 默认 3210 端口
```

`http://127.0.0.1:3210/` 即是完整游戏。

## 发布

```powershell
pwsh -File scripts\deploy-remote.ps1 -Message "改了什么"
```

或服务器上执行 `bash /opt/playcargame/deploy/deploy.sh`。
