# 霓裳汉服 · 妆造体验预约系统

为汉服妆造体验店提供的线上预约工具，前端模拟微信小程序 UX，后端 Node.js + SQLite。

## 快速启动

```bash
cd hanfu-booking
npm install
node server.js
# 访问 http://localhost:3000
```

## 功能清单

### 用户端
- 🎨 **客片展示** — 瀑布流展示，按风格分类筛选，图片放大预览
- 💄 **套餐浏览** — 套餐详情（名称、价格、时长、描述、封面）
- 📅 **档期预约** — 日历控件选择日期 → 时间段 → 填写信息 → 提交订单
- 💳 **微信支付** — 模拟支付锁定档期（15分钟待支付超时机制可扩展）
- ❌ **取消预约** — 按取消规则退款，时段自动释放
- 📋 **我的预约** — 订单列表（待支付/已预约/已完成/已取消），操作按钮

### 商家管理端
- 📋 **订单管理** — 筛选查看、核销（到店确认）、强制取消、导出 CSV 报表
- 📷 **客片管理** — 上传/删除客片、分类管理（增删改）
- 💄 **套餐管理** — 添加/编辑/删除/上下架套餐
- 📅 **档期配置** — 按星期设置营业日和时段、临时闭店日期
- ⚙️ **取消规则** — 配置免费取消时限、手续费类型（不可取消/按比例/固定金额）

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express 5 + better-sqlite3 |
| 前端 | Vue 3 (CDN) + 原生 CSS (模拟小程序风格) |
| 数据库 | SQLite（文件存储，零配置） |
| 文件上传 | multer（本地存储） |

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录（openid） |
| POST | `/api/auth/switch` | 切换用户（演示用） |
| GET | `/api/photos` | 客片列表，支持 `?category_id=` |
| POST | `/api/photos` | 上传客片（管理员） |
| GET | `/api/categories` | 分类列表 |
| GET | `/api/packages` | 套餐列表 |
| GET | `/api/slots/:date` | 某日可用时段 |
| POST | `/api/orders` | 创建预约订单 |
| POST | `/api/orders/:id/pay` | 支付 |
| POST | `/api/orders/:id/cancel` | 取消（自动退款） |
| POST | `/api/orders/:id/complete` | 核销（管理员） |
| GET | `/api/orders/export` | 导出 CSV（管理员） |
| GET/PUT | `/api/schedule` | 档期配置 |

## 演示数据

启动后自动填充：
- 6 个风格分类（唐风/宋制/明制/魏晋/异域/仙侠）
- 8 张示例客片
- 4 个套餐（¥199 ~ ¥999）
- 默认周一至周六营业，4 个时段
- 1 个管理员账号（商家管理）

## 微信小程序适配

当前为 Web 版原型，核心 API 和业务逻辑可直接复用。需替换的部分：
1. 用户认证：改为 `wx.login()` → code 换 openid
2. 支付：集成 `wx.requestPayment()`
3. 订阅消息：`wx.requestSubscribeMessage()`
4. 前端：转为小程序 WXML + WXSS
