# 在线版 · PlayCarGame（3D 公路自驾 · 双人联机比赛）

线上地址：<https://api.game.yhj123.dpdns.org/>

前端、后端、房间同步都跑在同一台阿里云服务器上，前端页面与 `/api/*` 同源，不依赖 GitHub Pages。

## 文件说明

| 文件 / 目录 | 作用 |
| --- | --- |
| `index.html` | 页面骨架：3D 画布、HUD（车速 / 比赛用时 / 最佳用时）、车王排行榜、房间入口、控制按钮、小地图画布、音乐开关 |
| `game.js` | 游戏主逻辑：Three.js 场景与赛道渲染、车辆物理、AI 车流、碰撞、计时与冲线判定、联机房间（SSE 实时同步）、小地图绘制、音效引擎 |
| `style.css` | 全部界面样式（含移动端适配） |
| `assets/three.min.js` | 本地 Three.js 引擎，不依赖 CDN |
| `assets/bgm.wav` | 背景音乐（默认静音，玩家点右上角喇叭才播放） |
| `assets/crash.wav` | 撞击音效 |
| `assets/coin.wav` | 金币音效 |
| `server.js` | Node 后端：静态文件托管、比赛成绩接口、房间接口、SSE 实时状态推送 |
| `package.json` | Node 项目描述与启动脚本 |
| `data/scores.json` | 排行榜数据（运行时生成，按用时排序，不进 git） |
| `deploy/bootstrap.sh` | 服务器首次部署：克隆代码、恢复数据、装 systemd + nginx、签发证书 |
| `deploy/deploy.sh` | 日常发布：`git pull` → 重启服务 → `nginx -t` → 健康检查 |
| `deploy/enable-tls.sh` | DNS 指向本机后一键签发证书并切到 443 |
| `deploy/nginx/game.yhj123.dpdns.org.conf` | 正式站点配置（80 跳转 + 443 反代到 Node） |
| `deploy/nginx/game.yhj123.dpdns.org.http.conf` | 过渡配置（只有 80，证书未签发时使用） |
| `deploy/systemd/playcargame.service` | 常驻服务定义（端口 3210，开机自启） |
| `scripts/deploy-remote.ps1` | Windows 本地一键：提交 → 推送 → 远端发布 |
| `docs/FRAMEWORK.md` | 架构说明、接口清单、改游戏逻辑时的注意事项 |

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活检查 |
| GET | `/api/scores` | 排行榜（按用时升序） |
| POST | `/api/scores` | 提交成绩 `{name, time}`，同名只保留最快 |
| POST | `/api/race/rooms` | `{action:"join", roomCode, name}` 进房（房间不存在则自动创建） |
| POST | `/api/race/state` | 上报自身状态 `{roomCode, playerId, x, heading, speed, distance, finished, time}` |
| POST | `/api/race/leave` | 退出房间，释放座位 |
| GET | `/api/race/stream` | SSE 实时推送房间内对手状态（每 40ms） |

## 玩法

1. 两人各自打开线上地址，填车手昵称
2. **两人输入同一个房间号**（≥3 位），各点一次「进入房间」，先到的自动建房
3. 两人到齐后自动 3-2-1 倒计时，同时起步
4. 踩油门才走，松手约 1 秒停住，时速上限 200 km/h
5. 撞到 AI 车是「弹开 + 减速」，不会出局
6. 先到终点的人赢；用时更短者排在车王排行榜前面

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
