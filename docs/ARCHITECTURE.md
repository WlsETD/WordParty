# 接字派對 後端架構

## 快速開始

```bash
npm install
npm test            # 單元 + 整合測試（Vitest）
npm run build       # 編譯 shared → server
npm start           # 啟動於 PORT（預設 8080）
npm run dev         # tsx watch 開發模式
npm run typecheck   # 需先 build shared
npm run gen:protocol  # 重新產生 docs/PROTOCOL.md
```

環境變數：`PORT`、`CORS_ORIGIN`（逗號分隔，預設 `*`）、`DICTIONARY_PATH`（預設 `packages/server/data/enable1.txt`）。

前端對接請看 [PROTOCOL.md](PROTOCOL.md)，型別直接從 `@wordparty/shared` 匯入。

## 選型：Socket.IO

- 協定是純 JSON 事件，`ClientToServerEvents` / `ServerToClientEvents` 直接給 Socket.IO 泛型，前後端共用同一份型別；不需要 Colyseus 的 schema 解碼器。
- 房間碼、重連 token、閒置回收、限流都是自訂規則，自己實作比繞過框架預設簡單。
- 遊戲邏輯完全不依賴傳輸層，測試可以注入假時鐘與固定亂數。
- 代價：要水平擴充需要 sticky session + Redis adapter。房間存在記憶體，**部署請只開一台**。

## 目錄

```
packages/
  shared/src/          協定型別（前後端共用）
    protocol.ts        C2S / S2C 事件、Ack、JoinResult、SubmitResult
    state.ts           RoomSnapshot、PlayerPublic、各模式 PublicState、GameEvent
    modes.ts           ModeId、各模式設定、預設值、上下限、Modifiers、GameSetup
    errors.ts items.ts constants.ts
  shared/scripts/gen-protocol-doc.ts   產生 docs/PROTOCOL.md
  server/src/
    core/              clock、rng（可設 seed）、rateLimiter、nickname
    dictionary/        Dictionary（ENABLE → Set）、validator（原因碼）
    modes/             GameMode 介面、registry、7 個模式各一檔
    game/              GameEngine（狀態機、計分、道具）、setup（設定驗證）
    rooms/             Room（成員、房主、重連）、RoomManager（房間碼、回收）
    transport/         gateway：Socket.IO ↔ Room 的唯一轉接層
  server/data/enable1.txt   ENABLE 公有領域單字表（172,823 字）
  server/test/unit/         字典、房間、狀態機、道具、每個模式
  server/test/integration/  10 個真實 socket 客戶端的錦標賽、競態、限流
```

## 分層與資料流

```
socket.io client ──► gateway（格式檢查、限流、session 綁定）
                        │
                        ▼
                     Room（成員/房主/重連/踢人）──► RoomOutput（snapshot / private / event）
                        │
                        ▼
                   GameEngine（LOBBY→COUNTDOWN→ROUND→ROUND_END→FINAL，總分、統計、道具）
                        │  RoundContext（validate / accept / reject / consumeShield / emit …）
                        ▼
                    GameMode 外掛（單一回合的規則）
```

- 全域一個 100ms 的 `setInterval` 呼叫 `RoomManager.tick()`：推進每個房間的狀態機、回收超過 60 秒的斷線座位、銷毀閒置 10 分鐘或空的房間，然後廣播。
- COUNTDOWN / ROUND 期間每個 tick 都送 `state:snapshot`，其他階段只在有變動時送。
- 同時送出的答案由 Node 單執行緒依收到順序處理，先處理者得分，後到者得到 `ALREADY_USED`（整合測試驗證 10 人同時搶同一字只有 1 人得分）。

## 新增一個模式

1. 在 `shared/src/modes.ts` 加入 `ModeId`、設定型別、`MODE_DEFAULTS`、`MODE_LIMITS`、`MODE_ITEMS`。
2. 在 `shared/src/state.ts` 加入它的 `XxxState` 並放進 `ModePublicState` 聯集。
3. 在 `server/src/modes/` 實作 `GameMode`（`onStart`、`onSubmit`、`onTick`、`getPublicState`、`isRoundOver`、`computeScores`、`getPlayerStatus`，選配 `onPlayerLeft`、`applyTimePenalty`、`personalDeadline`）。
4. 在 `modes/registry.ts` 註冊，補單元測試，`npm run gen:protocol`。

一律透過 `ctx.validate` 驗字（自動套用最短字長、禁用字母、鎖頭字母），透過 `ctx.accept` 記分（自動套用雙倍星星、清除鎖頭、更新統計、送出事件）。

## 模式規則摘要

| 模式 | 規則 | 計分 |
|---|---|---|
| 閃電搶答 | 同一起始字母，全場每字只能得分一次 | 字長 |
| 精準接龍 | 各自從同一起始字接龍；錯誤/重複扣分、連擊歸零、3 錯出局 | 字長 × 連擊倍率（3 連 ×1.5、6 連 ×2），錯誤 −2 |
| 炸彈傳遞 | 共用隱藏引信（隨機 20–45 秒）跨傳遞持續燃燒；每位持有者至少 3 秒；不可丟回給剛丟給你的人（剩 2 人時例外）；爆炸扣 1 命，暫停後重新點火 | 每次傳遞 2 分 + 每撐過一人 10 分 |
| 末位淘汰 | 每輪 heat 同一字母各自作答；heat 結束最低分淘汰（同分時最後有效作答較晚者淘汰，再同分隨機） | 字母總數 + 每撐過一人 10 分 |
| 組隊接力 | A/B 兩隊輪流接同一條龍，隊內輪替；逾時換對方隊；先到目標分或時間到比分 | 每字 5 分，勝隊每人 +20 |
| 合作長龍 | 全員共接一條龍，同一人不可連續接；1/3、2/3 里程碑與完成有全員獎勵 | 每字 3 分，里程碑各 +5，完成 +20 |
| 陷阱接龍 | 輪流接龍，每回合 1–3 條陷阱（禁含某字母、禁某字母結尾、字長上限）；踩陷阱扣 1 命 −3 分並換人；逾時扣 1 命 | 字長 −3/陷阱 + 每撐過一人 10 分 |

道具（`itemsEnabled`）：每回合每人各一個該模式支援的道具，使用後 8 秒冷卻。
縮時沙漏 −3 秒、封鎖鎖頭（目標下一個字不能含該字母，首字母除外）、護盾（擋一次爆炸/錯誤/陷阱/逾時/淘汰）、雙倍星星。已淘汰者仍可丟沙漏與鎖頭。

## 部署

- **Fly.io**：`fly launch --copy-config --no-deploy`，再 `fly deploy`。`fly.toml` 已關閉 auto-stop 並設健康檢查 `/healthz`；保持 1 台機器。
- **Railway**：連結 repo 後會讀 `railway.json`，用 Dockerfile 建置，1 個 replica。
- 正式環境請設定 `CORS_ORIGIN` 為前端網域。
