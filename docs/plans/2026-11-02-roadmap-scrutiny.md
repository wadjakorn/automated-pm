# รีวิวแผน UX, CLI และ MCP ก่อนเริ่มทำจริง

รีวิว: [`2026-11-01-ux-cli-mcp-agentic-roadmap.md`](2026-11-01-ux-cli-mcp-agentic-roadmap.md) · 2026-11-02

**คำตัดสิน: rework** ปัญหาที่แผนระบุนั้นมีจริงและวินิจฉัยถูก แต่ทางแก้ใหญ่เกินจำเป็น หลายส่วนสร้างกลไกที่ automation ตัวเดียวที่ใช้งานจริง (capz-loop) แก้ไว้แล้วใน bash และแผนยังมีข้อที่ขัดกันเองอย่างน้อย 2 จุด ซึ่งถ้าทำตามตรง ๆ จะทำให้ loop ที่รันอยู่พัง

## 1. เจตนาและทางที่ง่ายกว่า

**เป้าหมายในหนึ่งประโยค:** ให้คนและ agent ใส่งาน ย้ายสถานะ และดูข้อมูลได้สะดวก โดยให้ agent รันงานต่อเนื่องเองได้อย่างปลอดภัย

**สิ่งที่แผนมองข้าม:** มีคนเขียน automation แบบ agentic ไว้แล้ว คือ `~/development/capz/scripts/loop/run-stage.sh` ซึ่งทำสิ่งต่อไปนี้ได้แล้วโดยไม่ต้องแก้ server

| ความต้องการ | แผนเสนอ | capz-loop ทำอยู่แล้วด้วย |
|---|---|---|
| ไม่ให้รับงานซ้ำ | lease + `claim` endpoint | แบ่งงานตาม assignee (`pm ready --assignee capz-loop`) และ `flock` ต่อ stage |
| กู้งานที่ agent ตายค้าง | heartbeat + ตัวเก็บ lease | "doing ที่ไม่ขยับ 2 ชั่วโมงและไม่มี build รันอยู่ = crash → recover" โดย build จะสั่ง `move → doing` ซ้ำกับตั๋วที่อยู่ใน doing อยู่แล้ว ซึ่งได้ผลเพราะ B1 (ดู F0) |
| แยกประเภทงาน | labels | กรองด้วย title prefix `[release]` |
| ไม่ให้ข้อมูลผิดดูเหมือนมีงาน | `ready` คืน `not_found` | `pm_list` แปลง error เป็น `[]` พร้อมเขียน log |

**ทางที่เล็กกว่าและได้ผลราว 90%:**

1. **ปิด B1 ด้วยเงื่อนไขแบบเลือกใช้** `moveTask` เป็นฟังก์ชัน sync ตั้งแต่ `getTask` จนถึง `UPDATE` (`lib/repo.ts:786-804`) และ `better-sqlite3` อยู่ใน process เดียว จึงเพิ่ม `expect_from` ใน PATCH (CLI ใช้ `--from todo`) ได้ ถ้าสถานะปัจจุบันไม่ตรงจะตอบ `409 status_changed` พร้อม `current` ทำให้ใน claim พร้อมกันมีแค่ตัวแรกที่สำเร็จ ส่วนผู้เรียกที่ไม่ส่ง flag นี้ได้พฤติกรรมเหมือนเดิมทุกอย่าง **ห้าม**แก้แบบปฏิเสธการย้ายไปสถานะเดิมทั้งระบบ ซึ่งเป็นสิ่งที่รีวิวรอบแรกเสนอไว้ เพราะจะทำให้ capz-loop กู้งานค้างไม่ได้ (F0)
2. **เลื่อน lease/heartbeat ไปก่อน** จนกว่าจะมี poller ตัวที่สองแย่งงานในโปรเจกต์เดียวกันจริง ระหว่างนี้ให้แสดง "doing ที่ค้างเกิน N ชั่วโมง" บนเว็บก็พอ เพราะคนตัดสินใจเองได้
3. **ใช้ `projects.ready_status_key` แทน `statuses.category`** ทำตามแบบ `default_status_key` ที่มีอยู่แล้ว ได้ผลแบบเดียวกัน (ไม่ต้อง hardcode `todo`) โดยไม่ต้องสร้าง taxonomy 6 หมวดและหน้า settings ใหม่
4. **รวม event กับ comment เป็นตารางเดียว** (`task_activity`, `type = comment | status | field | link`) เพราะ Inbox, timeline และ `pm log` อ่านแหล่งเดียวกันอยู่แล้ว

## 2. ข้อที่พบ (เรียงตามความรุนแรง)

### Blocker

**F0. ถ้าปฏิเสธการย้ายไปสถานะเดิม การกู้งานค้างของ capz-loop จะพัง**
- **หลักฐาน:** `precheck_build` ส่ง `recover: <id>` ของตั๋วที่ค้างใน `doing` เกิน 2 ชั่วโมง (`capz-loop/scripts/loop/run-stage.sh`, ฟังก์ชัน `precheck_build`) จากนั้น skill `capz-build-ticket` ขั้น "1. Claim" สั่ง `pm task move --id <id> --status doing` เสมอ และระบุว่า "If the move fails with `conflict` or `illegal_transition`, another run owns it — stop" ปัจจุบันคำสั่งนี้ผ่านเพราะ B1 และยังอัปเดต `updated_at` ไปด้วย ซึ่งทำหน้าที่เป็น heartbeat โดยไม่ได้ตั้งใจ
- **ผลกระทบ:** ถ้าแก้ B1 แบบที่รีวิวรอบแรกเสนอ การกู้จะได้ error ทุกครั้ง build จะหยุดเพราะคิดว่ามีคนอื่นถืองานอยู่ และตั๋วจะค้างใน `doing` ตลอดไป
- **ทางแก้:** ใช้ `expect_from` ตามหัวข้อ 1 ข้อ 1 แล้วแก้ skill ของ capz-loop ให้ claim ด้วย `--from todo` เฉพาะกรณีตั๋วใหม่ ส่วนกรณี `recover:` ให้ข้ามการ claim ไปเลย โดย deploy server ก่อน แล้วค่อยแก้ skill

**F1. แผนขัดกันเองเรื่อง token**
- **ข้อที่ขัด:** ข้อ 0.1 ให้ `pm token show` และให้ `pm login` คืน token เดิม แต่ข้อ 1.7 ให้เก็บ token แบบ hash ซึ่งแสดงค่าเดิมไม่ได้อีก
- **ผลกระทบ:** ถ้าทำ 0.1 ตามที่เขียน แล้วมาทำ 1.7 ทีหลัง จะต้องรื้อคำสั่งที่เพิ่งปล่อย และเอกสารจะผิดอีกรอบ ซึ่งเป็นปัญหาเดียวกับ B2 ที่แผนตั้งใจจะแก้
- **ทางแก้:** ข้อ 0.1 ทำแค่ `pm token rotate` ที่ออก token ใหม่และแสดงครั้งเดียว ส่วน `pm login` ให้ออก token ใหม่ที่มีชื่อ (เช่น `login@host`) แทนการคืนค่าเดิม และตัด `token show` ออก

**F2. "routine เดิมรันได้โดยไม่ต้องแก้" ไม่จริงภายใต้ข้อ 1.5**
- **ข้อที่ขัด:** ข้อ 1.5 บังคับให้ PATCH ที่มี `description` จาก `actor.kind = agent` ต้องส่ง `version` แต่ CLI `task update` ส่ง version เฉพาะเมื่อระบุ `--version` (`cli/pm.ts:456`) และ server ข้ามการตรวจเมื่อไม่ส่ง (`lib/repo.ts:747-749`)
- **หลักฐาน:** skill `capz-loop` หัวข้อ "Talking to the owner" กำหนดว่าทุก stage สื่อสารกับเจ้าของผ่าน `## STATUS` ใน description ด้วย `pm task update --id <id> --description …` แบบ "re-read the ticket first" โดยไม่ส่ง `--version` และ build ยังเขียนสรุปแผนลง STATUS, verify นับรอบการแก้ไว้ใน STATUS, release เขียนสถานะ draft ลง STATUS
- **ผลกระทบ:** ทันทีที่ตั้ง `capz-loop` เป็น `kind=agent` ทั้ง 4 stage จะได้ `400` ทุกครั้งที่บันทึกความคืบหน้า
- **ทางแก้:** ตัดข้อบังคับนี้ทิ้ง เพราะเมื่อมี comment แล้ว agent ไม่จำเป็นต้องแก้ description บ่อย หรือถ้าจะเก็บไว้ ให้ CLI อ่าน version แล้วส่งเองโดยอัตโนมัติ ซึ่งตรงกับสิ่งที่ `AGENTS.md` อ้างอยู่แล้วแต่โค้ดไม่ได้ทำ

### Major

**F2b. ประตูอนุมัติของเจ้าของใน capz-loop ข้ามได้ และ PM ตรวจไม่ได้**
- **สภาพปัจจุบัน:** capz-loop ถือว่าตั๋วใน `todo` คือสิ่งที่เจ้าของอนุมัติแล้ว (skill `capz-loop` ตาราง Gate: "moves a backlog proposal to todo (accept)") และ intake เป็น stage เดียวที่อ่านข้อความจาก inbox ซึ่งไม่น่าเชื่อถือ
- **หลักฐาน:** `settings/intake.json` ห้าม `pm task move` แต่อนุญาต `Bash(pm task create:*)` ทุก flag ดังนั้นถ้า issue หลอกให้ intake สั่ง `pm task create --status todo --assignee capz-loop` ได้ build จะหยิบไปทำทันทีโดยเจ้าของไม่ได้อนุมัติ ส่วนกฎ "ใช้ `--status backlog`" อยู่แค่ใน prompt
- **สิ่งที่แผนพลาด:** ข้อ 0.10 ตรวจแค่ "ใครสร้างตั๋ว" ซึ่งกรณีนี้ creator เป็น `capz-loop` ที่ผ่านการตรวจอยู่แล้ว สิ่งที่ต้องตรวจคือ "ใครย้ายตั๋วเข้าสถานะพร้อมทำ"
- **ทางแก้:**
  - **ระยะสั้น (M1, ฝั่ง PM):** ปฏิเสธ `create` ที่ระบุ `status` เท่ากับ `ready_status_key` เมื่อ actor ไม่ใช่ human
  - **ระยะกลาง (M2):** ให้ `/ready` คืนเฉพาะตั๋วที่ transition ล่าสุดเข้าสถานะพร้อมทำทำโดย human ซึ่งตรวจได้เมื่อมีตาราง activity

**F3. ไม่ได้ระบุว่าจะบังคับ auth ตรงไหน (ข้อ 0.2 และ 0.8)**
- **สภาพปัจจุบัน:** `middleware.ts:37` ยกเว้น `/api` ทั้งหมด, `handle()` ไม่ได้รับ `req`, และจาก 24 route มีเพียง 4 route ที่เรียก `currentUser`
- **ผลกระทบ:** "การเขียนทุกอย่างต้องมี token" จึงต้องไล่แก้ทีละ route และถ้าพลาดไปหนึ่ง route ก็เป็นช่องโหว่ที่ไม่มีใครเห็น
- **ทางแก้:** สร้าง wrapper `handleWrite(req, fn)` ที่ตรวจ actor แล้วส่งต่อให้ repo และเพิ่มเทสต์ที่ไล่ทุกไฟล์ `app/api/**/route.ts` ว่า export `POST/PATCH/DELETE` ผ่าน wrapper นี้ทั้งหมด

**F4. ความต้องการ MCP ยังไม่มีผู้ใช้ชัดเจน**
- **สภาพปัจจุบัน:** Claude Code, Codex และ capz-loop ใช้ `pm` ผ่าน shell ได้อยู่แล้ว
- **ช่องโหว่ของแผน:** client ที่ไม่มี shell อย่าง claude.ai บนเว็บหรือมือถือ เชื่อม remote MCP จากฝั่ง cloud จึงเข้าถึง server ที่อยู่แค่ใน Tailscale ไม่ได้ ถ้าจะเปิดสู่ public ก็ต้องใช้ OAuth และขยายพื้นผิวการโจมตี ซึ่งแผนตัดออกไว้แล้ว
- **ผลกระทบ:** ถ้าไม่ระบุผู้ใช้ MCP 16 tools จะเป็นแค่ CLI ชุดที่สองที่ต้องดูแลคู่กัน
- **ทางแก้:** ระบุ client เป้าหมายก่อน ถ้าเป็นแค่ Claude Code และ Codex บนเครื่องนี้ ให้ทำ MCP แบบบาง 5-6 tools (`search`, `get`, `create`, `move`, `comment`, `whoami`) หลังจาก CLI ได้ `--view summary` และ `pm comment` แล้ว

**F5. `pm mv --path` เปิดทางให้ข้ามจุดตรวจของ state machine**
- **ผลกระทบ:** การเดินหลายขั้นในคำสั่งเดียวทำให้ agent ย้าย `backlog → released` ได้ ข้าม `tested` ซึ่งเป็นจุดที่คนตั้งใจให้หยุดตรวจ ขัดกับข้อ 3.2 (approval gate) ในแผนเดียวกัน
- **ทางแก้:** ตัดออก หรือเปิดให้เฉพาะ actor `human` และห้ามเข้าสถานะ final

**F6. แผนใหญ่เกินกำลังและติดคอขวดที่เฟส 1**
- **สภาพของแผน:** มีราว 60 งาน และทุกอย่างหลังเฟส 0 รอเฟส 1 ขนาด L ที่มี 8 หัวข้อย่อย
- **ผลกระทบ:** สำหรับผู้ดูแลคนเดียว คุณค่าส่วนใหญ่ (comment, search, ready ที่เคารพ blocker, summary view) จะถูกดึงช้าตาม lease, idempotency, labels และ subtask ซึ่งยังไม่มีหลักฐานว่าจำเป็น
- **ทางแก้:** แบ่งรอบใหม่ตามหัวข้อ 3

### Minor

**F7. ความเสี่ยง `write-token` ประเมินไว้สูงเกินจริง**
- **หลักฐาน:** ตั๋ว anonymous ในเดือนตุลาคมมี 2 ใบ ทั้งคู่อยู่ใน capz สร้างวันที่ 2026-10-07 เวลา 11:20 ซึ่งเป็นวันก่อนสร้าง user `capz-loop` (2026-10-08) และหลังจากนั้นไม่มีอีก token ที่ใช้งานจริงทั้งสองตัว (`codex` ใน `.bashrc` และ `capz-loop`) ก็ใช้ได้
- **ทางแก้:** เปิด `write-token` ได้เร็วกว่าที่แผนวางไว้ ไม่ต้องรอช่วงเก็บ log

**F8. ข้อ 0.10 ไม่มีผลกับข้อมูลปัจจุบัน**
- **หลักฐาน:** ตั๋ว `todo` ในโปรเจกต์ที่มี repo และไม่มี creator มี 0 ใบ เมื่อเปิด F3 แล้ว ตั๋วใหม่จะมี creator ทุกใบ
- **ทางแก้:** รวมเป็นส่วนหนึ่งของ F3 แทนการแยกเป็นงาน

**F9. ระบุแหล่งข้อมูลของ SSE ให้ชัด**
- **ปัญหา:** "SSE ต่อยอดจาก event log" อาจถูกตีความเป็น `EventEmitter` ในหน่วยความจำ ซึ่งขึ้นกับว่า route bundle ใช้ module ร่วมกันหรือไม่ (`lib/db.ts:9` เป็น singleton ระดับ module)
- **ทางแก้:** ให้ stream อ่านตาราง activity ด้วย `seq > last` ทุก ~1 วินาที ซึ่งทำงานถูกต้องไม่ว่า bundle จะแยกกันหรือไม่ และเป็นโค้ดชุดเดียวกับ `GET /api/events?since=`

**F10. ข้อ 0.11 ใหญ่เกินจำเป็น**
- **สภาพปัจจุบัน:** Sidebar มีปุ่มยุบและจำสถานะไว้ใน `localStorage` อยู่แล้ว (`components/Sidebar.tsx:33-51`) แต่ค่าเริ่มต้นเป็น `true`
- **ทางแก้:** ใต้ breakpoint `md` ให้ค่าเริ่มต้นเป็นยุบ และเปิดเป็น overlay

**F11. แก้ข้อความความเสี่ยง FTS5**
- **หลักฐาน:** `better-sqlite3` ในโปรเจกต์สร้างตาราง `fts5` ได้ (ทดสอบแล้ว)
- **ทางแก้:** ลบข้อความความเสี่ยงนี้และ fallback แบบ `LIKE`

## 3. ลำดับที่เสนอแทน

```mermaid
flowchart LR
  M1["M1 ปิดรูรั่ว<br/>เล็ก"] --> M2["M2 ความจำของงาน<br/>กลาง"]
  M2 --> M3["M3 หาและดู<br/>กลาง"]
  M3 -. มีหลักฐานว่าต้องการ .-> M4["M4 เมื่อจำเป็น"]
```

| รอบ | งาน | ที่มา |
|---|---|---|
| **M1 ปิดรูรั่ว** | `expect_from` / `--from` (B1, F0) + แก้ skill capz-build-ticket, กันไม่ให้ agent สร้างตั๋วลงสถานะพร้อมทำ (F2b), B2-B8, `pm token rotate`, `handleWrite` + `write-token`, `ready` ไม่คืนตั๋วที่ถูก `blocks`, `view=summary`, sidebar มือถือ, แถบบนของ drawer, ย้ายแล้วไม่ปิด drawer, quick add ต่อเนื่อง | แผนเดิมเฟส 0 + บางส่วนของ 1.4/1.8 |
| **M2 ความจำของงาน** | `task_activity` (event + comment), `pm comment`, `pm log`, timeline ใน drawer, Inbox = comment แบบ `question` ที่ยังไม่ได้ตอบ, `projects.ready_status_key`, `/ready` ตรวจว่าคนย้ายเข้าสถานะพร้อมทำ (F2b) แล้วย้าย capz-loop จาก `## STATUS` ใน description มาใช้ `pm comment` ซึ่งเป็นผู้ใช้จริงรายแรกของ comment | แผนเดิม 1.1-1.3 ฉบับย่อ + 3.1 |
| **M3 หาและดู** | FTS5 search + `pm search`, command palette, filter bar, Home ข้ามโปรเจกต์, SSE จากตาราง activity, MCP แบบบาง (ถ้าผ่าน F4) | แผนเดิม 1.8, 2B.1-2B.4, 2B.16, 2A ฉบับย่อ |
| **M4 เมื่อจำเป็น** | lease/heartbeat, idempotency, labels, subtask, artifacts, agent_runs, routing, webhook | ทำเมื่อมี poller แย่งงานกัน หรือมีงานที่ต้องการจริง |

**เกณฑ์เข้า M4:** มี poller ตั้งแต่สองตัวขึ้นไปทำงานในโปรเจกต์เดียวกันโดยไม่ได้แบ่งตาม assignee หรือมีตั๋วค้างที่ต้องกู้ด้วยมือเกินสัปดาห์ละครั้ง

## 4. สิ่งที่ตรวจแล้วว่าถูกต้อง

- **B1:** การ claim พร้อมกันสำเร็จทุกตัวเพราะ `fromKey === toKey` คืน `ok` และ `moveTask` bump version เสมอ
- **B2:** login route ไม่คืน token (`app/api/auth/login/route.ts:17`)
- **B3:** Bearer ที่ไม่ถูกต้องตกไปเช็ก cookie แล้วกลายเป็น anonymous (`lib/auth.ts:63-73`)
- **B4:** `listReadyTickets` คืน `[]` เมื่อไม่พบโปรเจกต์หรือ assignee (`lib/repo.ts:607-619`) และ capz-loop จัดการได้อยู่แล้ว ข้อแก้ในแผนจึงใช้กับ `pm_list` ได้โดยไม่ทำให้อะไรพัง
- **U-series:** ยืนยันจาก screenshot และ DOM ไปแล้วในรอบก่อน

## 5. ขอบเขตที่ตรวจ

- **ตรวจแล้ว:** skill ทั้ง 5 ตัวของ capz-loop (`capz-loop`, `capz-triage`, `capz-build-ticket`, `capz-verify-pr`, `capz-release`), `run-stage.sh` และ `settings/*.json` ใน clone ที่ runner ใช้จริง (`~/development/capz-loop`) ซึ่งตรงกับ `~/development/capz` ทุกไฟล์
- **การใช้ `pm` ที่ capz-loop พึ่งพา และต้องไม่พังหลังแก้:**
  - field `.ticket` และ `.title` ของ `pm ready`
  - `pm task get --include-deleted` (ใช้ `deleted_at` ตัดสินว่าเจ้าของปฏิเสธ)
  - `pm task list --status --assignee` และ field `updated_at`
  - `pm task move` ทีละขั้น
  - `pm task create --status backlog --assignee capz-loop --priority`
  - `pm task update --description`
- **ไม่มี instance อื่นแล้ว:** เลิกใช้ dietpi ระบบจึงมีแค่ instance บนเครื่องนี้
- **ยังไม่ได้ลอง:** route bundle ของ Next ใช้ module ร่วมกันจริงหรือไม่ (F9 เลือกทางที่ไม่ขึ้นกับเรื่องนี้)
